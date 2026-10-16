// The gamepad, as a third way in beside the thumbs and the keyboard. The
// Gamepad API has no events for sticks and buttons, so the pad is polled
// once per animation frame (the first connected pad with the standard
// mapping) and compared with the previous frame for the edges.
//
// Two modes, by the battle's phase:
//
//   playing   — the pad writes into TouchInputService through the same
//               setters the keyboard uses (one ControlSource, nothing new in
//               the command): left stick = drive, digital per direction like
//               WASD; right stick = turret left/right and camera up/down;
//               R1 or Cross = fire (held: the Shaft's own sniper aim); d-pad = the
//               supplies 1-4 clockwise from the top; R3 = nuclear; L3 held =
//               self-destruct (the 5 s hold runs in the respawn system); Start
//               = pause (a synthetic Escape, like the key); Select = the score
//               table while held (a synthetic Tab).
//   otherwise — the pad is a keyboard for the screens: d-pad and left stick
//               are the arrows, Cross / A is Enter, Circle / B and Start are
//               Escape. The keys go out as synthetic KeyboardEvents on the
//               focused element, so every screen that walks on the keyboard
//               (the menu's rows, the pause box, the lobby's fields, the
//               fullscreen prompt) walks on the pad without knowing it.
import type { Axis, SupplyKind } from '../../../../model/TankCommand';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type LoggerService from '../base/LoggerService';
import type BattleStateService from '../battle/BattleStateService';
import type TouchInputService from './TouchInputService';

/** A stick past this (of 1) counts as pressed in that direction. */
const STICK_THRESHOLD = 0.5;
/** Held d-pad / stick in a screen: the first repeat after this, then every REPEAT_EVERY_MS. */
const REPEAT_DELAY_MS = 400;
const REPEAT_EVERY_MS = 120;

/** Standard mapping (w3c): buttons[] indices. */
const BTN = {
  cross: 0,
  circle: 1,
  l1: 4,
  r1: 5,
  select: 8,
  start: 9,
  l3: 10,
  r3: 11,
  up: 12,
  down: 13,
  left: 14,
  right: 15,
} as const;

/** The d-pad clockwise from the top: the supply slots 1-4. */
const DPAD_SUPPLIES: [number, SupplyKind][] = [
  [BTN.up, 'health'],
  [BTN.right, 'armor'],
  [BTN.down, 'damage'],
  [BTN.left, 'nitro'],
];

type ScreenKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Enter' | 'Escape' | 'Tab';

interface HeldKey {
  sinceMs: number;
  repeats: number;
}

export class GamepadInputService {
  private readonly loggerService = inject<LoggerService>(TYPES.loggerService);
  private readonly battleStateService = inject<BattleStateService>(TYPES.battleStateService);
  private readonly touchInputService = inject<TouchInputService>(TYPES.touchInputService);

  private frame: number | null = null;
  private padIndex: number | null = null;
  /** Buttons down on the previous frame (by index). */
  private wasDown = new Set<number>();
  /** Synthetic keys currently held, for the pairing keyup and the auto-repeat. */
  private readonly heldKeys = new Map<ScreenKey, HeldKey>();
  /** Keys already down when the mode switched: they count again only after a release (the Start that opened the pause must not close it). */
  private readonly blocked = new Set<ScreenKey>();
  /** Buttons already down when the battle resumed: spent until released (the Cross that pressed RESUME must not fire). */
  private readonly spent = new Set<number>();
  private inBattle = false;
  /** What the pad last wrote into the battle input: it writes again only on a change, so a pad at rest never overrides the keyboard or the thumbs. */
  private battleOut = { stickX: 0, stickY: 0, turret: 0 as Axis, camera: 0 as Axis, fire: false, selfDestruct: false };
  private readonly activityListeners = new Set<() => void>();

  /** True while a pad is connected and was seen this session. */
  public get connected(): boolean {
    return this.padIndex != null;
  }

  /** Starts polling; idempotent. */
  public attach = (): void => {
    if (this.frame != null || typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return;
    window.addEventListener('gamepadconnected', this.onConnected);
    window.addEventListener('gamepaddisconnected', this.onDisconnected);
    const loop = (): void => {
      this.frame = requestAnimationFrame(loop);
      this.poll(performance.now());
    };
    this.frame = requestAnimationFrame(loop);
    this.loggerService.log('gamepad polling attached');
  };

  public detach = (): void => {
    if (this.frame != null) cancelAnimationFrame(this.frame);
    this.frame = null;
    window.removeEventListener('gamepadconnected', this.onConnected);
    window.removeEventListener('gamepaddisconnected', this.onDisconnected);
    this.releaseEverything();
    this.padIndex = null;
  };

  /** Any press or stick move on the pad (the touch controls fade on it, like on a key). */
  public onActivity = (listener: () => void): (() => void) => {
    this.activityListeners.add(listener);
    return () => this.activityListeners.delete(listener);
  };

  // --- internals -----------------------------------------------------------------

  private onConnected = (e: GamepadEvent): void => {
    this.loggerService.log('gamepad connected', e.gamepad.id, e.gamepad.mapping || 'no mapping');
  };

  private onDisconnected = (e: GamepadEvent): void => {
    if (e.gamepad.index === this.padIndex) {
      this.loggerService.log('gamepad disconnected', e.gamepad.id);
      this.releaseEverything();
      this.wasDown.clear();
      this.padIndex = null;
    }
  };

  private pickPad(): Gamepad | null {
    let pads: (Gamepad | null)[];
    try {
      pads = navigator.getGamepads();
    } catch {
      return null;
    }
    if (this.padIndex != null) {
      const current = pads[this.padIndex];
      if (current != null && current.connected) return current;
      this.padIndex = null;
      this.releaseEverything();
      this.wasDown.clear();
    }
    for (const pad of pads) {
      if (pad != null && pad.connected && pad.mapping === 'standard') {
        this.padIndex = pad.index;
        this.loggerService.log('gamepad in use', pad.id);
        return pad;
      }
    }
    return null;
  }

  private poll(nowMs: number): void {
    const pad = this.pickPad();
    if (pad == null) return;
    const down = new Set<number>();
    pad.buttons.forEach((button, index) => {
      if (button.pressed || button.value > 0.5) down.add(index);
    });
    const battle = this.battleStateService.phase === 'playing';
    if (battle !== this.inBattle) {
      // Switching modes: nothing held carries over (a stick held into the pause must not drive after RESUME),
      // and whatever is down right now is spent (the Start that opened the pause must not close it next frame).
      this.releaseEverything();
      this.inBattle = battle;
      this.wasDown = down;
      for (const key of this.screenKeys(pad, down)) this.blocked.add(key);
      for (const index of down) this.spent.add(index);
    }
    for (const index of this.spent) if (!down.has(index)) this.spent.delete(index);
    // Activity is a CHANGE on the pad, not a held state: the thumb controls fade on it and come back on the next touch.
    let activity = down.size !== this.wasDown.size || [...down].some((i) => !this.wasDown.has(i));
    if (battle) activity = this.pollBattle(pad, down) || activity;
    else activity = this.pollScreen(pad, down, nowMs) || activity;
    this.wasDown = down;
    if (activity) for (const listener of [...this.activityListeners]) listener();
  }

  private pressed(down: Set<number>, index: number): boolean {
    return down.has(index) && !this.wasDown.has(index);
  }

  // --- the battle ------------------------------------------------------------------

  /**
   * The pad's battle inputs go to TouchInputService only when THEY change
   * (like the keyboard's key events): a connected pad lying still writes
   * nothing, so the keyboard and the thumb controls keep working beside it;
   * letting a stick go writes the zero once. Returns true when something changed.
   */
  private pollBattle(pad: Gamepad, down: Set<number>): boolean {
    const input = this.touchInputService;
    const out = this.battleOut;
    let changed = false;
    const [lx = 0, ly = 0, rx = 0, ry = 0] = pad.axes;
    // Digital per direction, like WASD: the chassis gets -1 / 0 / +1.
    const stickX = (lx > STICK_THRESHOLD ? 1 : 0) - (lx < -STICK_THRESHOLD ? 1 : 0);
    const stickY = (ly < -STICK_THRESHOLD ? 1 : 0) - (ly > STICK_THRESHOLD ? 1 : 0);
    if (stickX !== out.stickX || stickY !== out.stickY) {
      out.stickX = stickX;
      out.stickY = stickY;
      input.setStick(stickX, stickY, true);
      changed = true;
    }
    // Right stick: left = turret left (+1, the original convention), up = camera up (+1, like Q).
    const turret = ((rx < -STICK_THRESHOLD ? 1 : 0) - (rx > STICK_THRESHOLD ? 1 : 0)) as Axis;
    if (turret !== out.turret) {
      out.turret = turret;
      input.setTurret(turret);
      changed = true;
    }
    const camera = ((ry < -STICK_THRESHOLD ? 1 : 0) - (ry > STICK_THRESHOLD ? 1 : 0)) as Axis;
    if (camera !== out.camera) {
      out.camera = camera;
      input.setCameraTilt(camera);
      changed = true;
    }
    // A button still held from the pause screen (the Cross on RESUME) is nobody's input until it is released.
    const live = (index: number): boolean => down.has(index) && !this.spent.has(index);
    // R1 or Cross: fire (held: the Shaft's own sniper aim).
    const fire = live(BTN.r1) || live(BTN.cross);
    if (fire !== out.fire) {
      out.fire = fire;
      input.setFire(fire);
      changed = true;
    }
    for (const [index, kind] of DPAD_SUPPLIES) {
      if (this.pressed(down, index)) input.requestSupply(kind);
    }
    if (this.pressed(down, BTN.r3)) input.requestSupply('nuclear');
    // L3 held: self-destruct — the 5 s hold and its progress ring are the respawn system's, as with the on-screen button.
    const selfDestruct = live(BTN.l3);
    if (selfDestruct !== out.selfDestruct) {
      out.selfDestruct = selfDestruct;
      input.setSelfDestruct(selfDestruct);
      changed = true;
    }
    // Start: the pause, as Escape does (GameFacadeService listens on the window).
    if (this.pressed(down, BTN.start)) this.tap('Escape');
    // Select: the score table while held, as Tab does (HudService).
    this.hold('Tab', live(BTN.select), 0, false);
    return changed;
  }

  // --- the screens -----------------------------------------------------------------

  /** The screen keys the pad holds right now: d-pad and left stick = arrows, Cross = Enter, Circle / Start = Escape. */
  private screenKeys(pad: Gamepad, down: Set<number>): Set<ScreenKey> {
    const [lx = 0, ly = 0] = pad.axes;
    const keys = new Set<ScreenKey>();
    if (down.has(BTN.up) || ly < -STICK_THRESHOLD) keys.add('ArrowUp');
    if (down.has(BTN.down) || ly > STICK_THRESHOLD) keys.add('ArrowDown');
    if (down.has(BTN.left) || lx < -STICK_THRESHOLD) keys.add('ArrowLeft');
    if (down.has(BTN.right) || lx > STICK_THRESHOLD) keys.add('ArrowRight');
    if (down.has(BTN.cross)) keys.add('Enter');
    if (down.has(BTN.circle) || down.has(BTN.start)) keys.add('Escape');
    return keys;
  }

  /** Returns true when a screen key went down or up this frame. */
  private pollScreen(pad: Gamepad, down: Set<number>, nowMs: number): boolean {
    const keys = this.screenKeys(pad, down);
    const before = this.heldKeys.size;
    let changed = false;
    for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape'] as const) {
      const was = this.heldKeys.has(key);
      this.hold(key, keys.has(key), nowMs, key.startsWith('Arrow'));
      if (was !== this.heldKeys.has(key)) changed = true;
    }
    return changed || before !== this.heldKeys.size;
  }

  /** A key that follows a button: keydown on press, keyup on release, repeats while held when `repeat`. */
  private hold(key: ScreenKey, isDown: boolean, nowMs: number, repeat: boolean): void {
    if (!isDown) this.blocked.delete(key);
    else if (this.blocked.has(key)) return;
    const held = this.heldKeys.get(key);
    if (isDown && held == null) {
      this.heldKeys.set(key, { sinceMs: nowMs, repeats: 0 });
      this.dispatch('keydown', key, false);
    } else if (!isDown && held != null) {
      this.heldKeys.delete(key);
      this.dispatch('keyup', key, false);
    } else if (isDown && held != null && repeat) {
      const due = REPEAT_DELAY_MS + held.repeats * REPEAT_EVERY_MS;
      if (nowMs - held.sinceMs >= due) {
        held.repeats++;
        this.dispatch('keydown', key, true);
      }
    }
  }

  /** A key pressed and released at once. */
  private tap(key: ScreenKey): void {
    this.dispatch('keydown', key, false);
    this.dispatch('keyup', key, false);
  }

  /**
   * The key as the browser would send it, on the element that has the
   * caret (so a text field sees it and the menu's INPUT check holds) or the
   * window. The listeners read `key` and `code`; for these keys they match.
   */
  private dispatch(type: 'keydown' | 'keyup', key: ScreenKey, repeat: boolean): void {
    const target: EventTarget = document.activeElement != null && document.activeElement !== document.body ? document.activeElement : window;
    target.dispatchEvent(new KeyboardEvent(type, { key, code: key, bubbles: true, cancelable: true, repeat }));
  }

  /** Every held key and every battle input let go (a mode switch, a lost pad, detach). */
  private releaseEverything(): void {
    for (const key of [...this.heldKeys.keys()]) {
      this.heldKeys.delete(key);
      this.dispatch('keyup', key, false);
    }
    if (this.inBattle && (this.battleOut.stickX !== 0 || this.battleOut.stickY !== 0 || this.battleOut.turret !== 0 || this.battleOut.camera !== 0 || this.battleOut.fire || this.battleOut.selfDestruct)) {
      // Only what the pad itself holds is let go; a stick or key the player holds elsewhere is not the pad's to release.
      this.touchInputService.releaseAll();
    }
    this.battleOut = { stickX: 0, stickY: 0, turret: 0, camera: 0, fire: false, selfDestruct: false };
  }
}

export default GamepadInputService;
