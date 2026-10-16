// The human's control source. The touch UI (TouchControlsService, HudService)
// writes into this model; the source turns it into TankCommands for the
// local actor's inbox — on every change, and once per physics tick as a
// keepalive so a held button survives a missed event.
//
// An optional keyboard mapping is kept for desktop debugging of the PWA.
import { createCommand, type Axis, type SupplyKind, type TankCommand } from '../../../../model/TankCommand';
import type { CommandSink, ControlSource, ControlSourceEnv } from '../../../../model/ControlSource';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type LoggerService from '../base/LoggerService';

export interface TouchState {
  /** Joystick vector, -1..1 each (x right, y forward). */
  stickX: number;
  stickY: number;
  turret: Axis;
  turretCenter: boolean;
  fire: boolean;
  selfDestruct: boolean;
  cameraTilt: Axis;
}

const DEAD_ZONE = 0.18;

export class TouchInputService {
  private readonly loggerService = inject<LoggerService>(TYPES.loggerService);

  private readonly state: TouchState = {
    stickX: 0,
    stickY: 0,
    turret: 0,
    turretCenter: false,
    fire: false,
    selfDestruct: false,
    cameraTilt: 0,
  };
  private pendingSupply: SupplyKind | null = null;
  private sink: CommandSink | null = null;
  private enabled = true;
  private keyboardDetach: (() => void) | null = null;

  // --- written by the UI ---------------------------------------------------

  /** True while the stick values come from the keyboard (WASD), not a thumb. */
  private stickFromKeyboard = false;

  public setStick = (x: number, y: number, fromKeyboard = false): void => {
    const nx = Math.max(-1, Math.min(1, x));
    const ny = Math.max(-1, Math.min(1, y));
    if (nx !== this.state.stickX || ny !== this.state.stickY || fromKeyboard !== this.stickFromKeyboard) {
      this.state.stickX = nx;
      this.state.stickY = ny;
      this.stickFromKeyboard = fromKeyboard;
      this.flush();
    }
  };

  public setTurret = (axis: Axis): void => {
    if (this.state.turret !== axis) {
      this.state.turret = axis;
      this.flush();
    }
  };

  public setTurretCenter = (held: boolean): void => {
    if (this.state.turretCenter !== held) {
      this.state.turretCenter = held;
      this.flush();
    }
  };

  public setFire = (held: boolean): void => {
    if (this.state.fire !== held) {
      this.state.fire = held;
      this.flush();
    }
  };

  public setSelfDestruct = (held: boolean): void => {
    if (this.state.selfDestruct !== held) {
      this.state.selfDestruct = held;
      this.flush();
    }
  };

  public setCameraTilt = (axis: Axis): void => {
    if (this.state.cameraTilt !== axis) {
      this.state.cameraTilt = axis;
      this.flush();
    }
  };

  /** One-shot: consumed by the next command. */
  public requestSupply = (kind: SupplyKind): void => {
    this.pendingSupply = kind;
    this.flush();
  };

  /** Releases everything held (pause, focus loss, death). */
  public releaseAll = (): void => {
    this.state.stickX = 0;
    this.state.stickY = 0;
    this.state.turret = 0;
    this.state.turretCenter = false;
    this.state.fire = false;
    this.state.selfDestruct = false;
    this.state.cameraTilt = 0;
    this.pendingSupply = null;
    this.flush();
  };

  /** While disabled (menus up) the source emits idle commands only. */
  public setEnabled = (enabled: boolean): void => {
    this.enabled = enabled;
    if (!enabled) {
      this.releaseAll();
    }
  };

  public snapshot = (): Readonly<TouchState> => this.state;

  // --- the ControlSource ---------------------------------------------------

  public createSource = (): ControlSource => {
    const self = this;
    return {
      kind: 'touch',
      async start(sink: CommandSink, _env: ControlSourceEnv): Promise<void> {
        self.sink = sink;
        self.flush();
      },
      tick(): void {
        // Keepalive: the buffer repeats the last command anyway, but a push
        // per tick keeps the one-shot semantics simple and costs nothing.
        self.flush();
      },
      stop(): void {
        if (self.sink != null) {
          self.sink = null;
        }
      },
    };
  };

  /** Desktop debugging: WASD / arrows, Z X C, Space, 1-5, 0, Q E. */
  public attachKeyboard = (target: Window = window): (() => void) => {
    this.keyboardDetach?.();
    const down = new Set<string>();
    const sync = (): void => {
      const forward = down.has('KeyW') || down.has('ArrowUp') ? 1 : 0;
      const back = down.has('KeyS') || down.has('ArrowDown') ? 1 : 0;
      const left = down.has('KeyA') || down.has('ArrowLeft') ? 1 : 0;
      const right = down.has('KeyD') || down.has('ArrowRight') ? 1 : 0;
      this.setStick(right - left, forward - back, true);
      this.setTurret((down.has('KeyZ') ? 1 : 0) - (down.has('KeyX') ? 1 : 0) as Axis);
      this.setTurretCenter(down.has('KeyC'));
      this.setFire(down.has('Space'));
      this.setSelfDestruct(down.has('Digit0'));
      this.setCameraTilt((down.has('KeyQ') ? 1 : 0) - (down.has('KeyE') ? 1 : 0) as Axis);
    };
    const supplies: Record<string, SupplyKind> = {
      Digit1: 'health', Digit2: 'armor', Digit3: 'damage', Digit4: 'nitro', Digit5: 'nuclear',
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.repeat) return;
      if (supplies[e.code] != null) {
        this.requestSupply(supplies[e.code]);
        return;
      }
      down.add(e.code);
      sync();
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      down.delete(e.code);
      sync();
    };
    const onBlur = (): void => {
      down.clear();
      this.releaseAll();
    };
    target.addEventListener('keydown', onKeyDown);
    target.addEventListener('keyup', onKeyUp);
    target.addEventListener('blur', onBlur);
    this.loggerService.log('keyboard attached');
    this.keyboardDetach = () => {
      target.removeEventListener('keydown', onKeyDown);
      target.removeEventListener('keyup', onKeyUp);
      target.removeEventListener('blur', onBlur);
      this.keyboardDetach = null;
    };
    return this.keyboardDetach;
  };

  // --- internals -----------------------------------------------------------

  private flush(): void {
    const sink = this.sink;
    if (sink == null) {
      return;
    }
    sink.push(this.compose());
  }

  private compose(): TankCommand {
    if (!this.enabled) {
      return createCommand();
    }
    const s = this.state;
    const supply = this.pendingSupply;
    this.pendingSupply = null;
    // The stick's Y is the throttle; X is the turn (left is +1 in the
    // original convention, so the sign flips). Values are proportional:
    // the chassis integrates `move * acceleration`.
    const move = Math.abs(s.stickY) > DEAD_ZONE ? s.stickY : 0;
    // Car-like: the stick's X is the steering wheel whether driving forward
    // or back, so stick-left always yaws the hull counter-clockwise (the
    // original's S+A). No inversion while reversing.
    const turn = Math.abs(s.stickX) > DEAD_ZONE ? -s.stickX : 0;
    return createCommand({
      move,
      turn,
      // The chassis' own BIT_REVERSE_TURN only fires at exactly -1 (digital
      // keys); the analog stick handles its inversion above instead.
      reverseBackTurn: false,
      turret: s.turret,
      turretCenter: s.turretCenter,
      fire: s.fire,
      supply,
      selfDestruct: s.selfDestruct,
      cameraTilt: s.cameraTilt,
    });
  }
}

export default TouchInputService;
