// The on-screen controls, laid out for two thumbs in landscape:
//
//   left half   — a floating joystick: it appears wherever the thumb lands,
//                 so there is nothing to look for; up/down drives, left/right
//                 turns, proportionally;
//   right side  — FIRE (big, bottom corner), turret left/right beside it,
//                 CENTRE above, camera tilt and the held self-destruct in
//                 the top row.
//
// Everything writes into TouchInputService; nothing here knows about tanks.
import { assetUrl } from '../../../../engine/tank/TankAssets';
import { h, holdable } from '../../../../ui/dom';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type UiRootService from './UiRootService';
import type TouchInputService from '../control/TouchInputService';
import type GamepadInputService from '../control/GamepadInputService';

const STICK_RADIUS = 52;

export class TouchControlsService {
  private readonly uiRootService = inject<UiRootService>(TYPES.uiRootService);
  private readonly touchInputService = inject<TouchInputService>(TYPES.touchInputService);
  private readonly gamepadInputService = inject<GamepadInputService>(TYPES.gamepadInputService);

  private suicideFill: HTMLElement | null = null;

  private detachKeyboardFade: (() => void) | null = null;

  public show = (): void => {
    const root = h('div', { class: 'controls' });
    root.appendChild(this.buildStick());
    root.appendChild(this.buildCameraDock());
    root.appendChild(this.buildCluster());
    this.uiRootService.show('controls', root);
    // A keyboard or gamepad player does not need the thumb controls in the
    // way: any key or pad input fades them (the supply row in the HUD stays),
    // the next touch brings them back.
    const onKey = (): void => root.classList.add('is-keyboard');
    const onPointer = (): void => root.classList.remove('is-keyboard');
    window.addEventListener('keydown', onKey);
    root.addEventListener('pointerdown', onPointer, true);
    const offPad = this.gamepadInputService.onActivity(onKey);
    this.detachKeyboardFade = () => {
      window.removeEventListener('keydown', onKey);
      root.removeEventListener('pointerdown', onPointer, true);
      offPad();
    };
  };

  public hide = (): void => {
    this.detachKeyboardFade?.();
    this.detachKeyboardFade = null;
    this.uiRootService.hide('controls');
    this.suicideFill = null;
    this.touchInputService.releaseAll();
  };

  public setSuicideProgress = (fraction: number): void => {
    if (this.suicideFill != null) {
      this.suicideFill.style.height = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
    }
  };

  // --- joystick ---------------------------------------------------------------

  /**
   * The stick rests in the bottom-left corner and the whole left half of the
   * screen is its hit area: on touch it jumps under the thumb and the knob
   * offset is measured from that centre; on release it returns to the corner.
   */
  private buildStick(): HTMLElement {
    const knob = h('div', { class: 'knob' });
    const stick = h('div', { class: 'stick is-on' }, knob, h('div', { class: 'stick-label', text: 'drive' }));
    const zone = h('div', { class: 'zone-left' }, stick);
    let pointerId: number | null = null;

    const center = (): { x: number; y: number } => {
      const rect = stick.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    };
    const update = (clientX: number, clientY: number): void => {
      const c = center();
      let dx = clientX - c.x;
      let dy = clientY - c.y;
      const length = Math.hypot(dx, dy);
      if (length > STICK_RADIUS) {
        dx *= STICK_RADIUS / length;
        dy *= STICK_RADIUS / length;
      }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      // Screen Y grows downward; the stick's Y is "forward".
      this.touchInputService.setStick(dx / STICK_RADIUS, -dy / STICK_RADIUS);
    };
    const release = (): void => {
      pointerId = null;
      stick.classList.remove('is-active');
      knob.style.transform = '';
      // Back to its resting corner until the next touch.
      stick.style.left = '';
      stick.style.top = '';
      stick.style.bottom = '';
      this.touchInputService.setStick(0, 0);
    };

    zone.addEventListener('pointerdown', (e) => {
      if (pointerId != null) return;
      e.preventDefault();
      pointerId = e.pointerId;
      try {
        zone.setPointerCapture(e.pointerId);
      } catch {
        // synthetic events carry no active pointer
      }
      // The stick jumps under the thumb wherever it lands in the left half,
      // so there is nothing to aim for; it returns to the corner on release.
      const zoneRect = zone.getBoundingClientRect();
      stick.style.left = `${e.clientX - zoneRect.left - stick.offsetWidth / 2}px`;
      stick.style.top = `${e.clientY - zoneRect.top - stick.offsetHeight / 2}px`;
      stick.style.bottom = 'auto';
      stick.classList.add('is-active');
      update(e.clientX, e.clientY);
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pointerId) return;
      update(e.clientX, e.clientY);
    });
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      zone.addEventListener(name, (e) => {
        if (e.pointerId === pointerId) release();
      });
    }
    zone.addEventListener('contextmenu', (e) => e.preventDefault());
    return zone;
  }

  // --- camera dock: top-left, beside the HUD's score-table button --------------

  private buildCameraDock(): HTMLElement {
    const input = this.touchInputService;
    const camUp = h('div', { class: 'ctl ctl-cam-up', text: '▲', attrs: { title: 'Camera up' } });
    const camDown = h('div', { class: 'ctl ctl-cam-down', text: '▼', attrs: { title: 'Camera down' } });
    let upHeld = false;
    let downHeld = false;
    const syncCam = (): void => input.setCameraTilt(((upHeld ? 1 : 0) - (downHeld ? 1 : 0)) as -1 | 0 | 1);
    holdable(camUp, (held) => {
      upHeld = held;
      syncCam();
    });
    holdable(camDown, (held) => {
      downHeld = held;
      syncCam();
    });
    return h('div', { class: 'camera-dock' }, camUp, camDown);
  }

  // --- right-hand cluster: turret, centre, self-destruct, FIRE -----------------

  private buildCluster(): HTMLElement {
    const input = this.touchInputService;
    const fire = h('div', { class: 'ctl ctl-fire', text: 'FIRE' });
    holdable(fire, (held) => input.setFire(held));
    const left = h('div', { class: 'ctl ctl-turret-left', text: '↶' });
    const right = h('div', { class: 'ctl ctl-turret-right', text: '↷' });
    let leftHeld = false;
    let rightHeld = false;
    const syncTurret = (): void => input.setTurret(((leftHeld ? 1 : 0) - (rightHeld ? 1 : 0)) as -1 | 0 | 1);
    holdable(left, (held) => {
      leftHeld = held;
      syncTurret();
    });
    holdable(right, (held) => {
      rightHeld = held;
      syncTurret();
    });
    const center = h('div', { class: 'ctl ctl-center', text: 'C' });
    holdable(center, (held) => input.setTurretCenter(held));
    this.suicideFill = h('div', { class: 'fill' });
    const suicide = h(
      'div',
      { class: 'ctl ctl-suicide', attrs: { title: 'Hold to self-destruct' } },
      this.suicideFill,
      h('img', { attrs: { src: assetUrl('/icons/status/nuclear.svg'), alt: '' } }),
    );
    holdable(suicide, (held) => input.setSelfDestruct(held));
    return h('div', { class: 'cluster' }, suicide, center, left, right, fire);
  }
}

export default TouchControlsService;
