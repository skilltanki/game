// The DOM root of every screen. Screens live in fixed layers (z-order) so a
// result modal always sits above the HUD, and the loading screen above all.
// Also binds the SWF 9-slice sprites to CSS variables so theme.css can draw
// the brand buttons from wherever the asset resolver serves them.
import { assetUrl } from '../../../../engine/tank/TankAssets';
import { h } from '../../../../ui/dom';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type LoggerService from '../base/LoggerService';

export type LayerName = 'controls' | 'hud' | 'menu' | 'prompt' | 'pause' | 'result' | 'loading' | 'rotate';

const LAYER_ORDER: LayerName[] = ['controls', 'hud', 'menu', 'prompt', 'pause', 'result', 'loading', 'rotate'];

export class UiRootService {
  private readonly loggerService = inject<LoggerService>(TYPES.loggerService);

  private root: HTMLElement | null = null;
  private readonly layers = new Map<LayerName, HTMLElement>();
  private rotateOverlay: HTMLElement | null = null;
  private battleWantsLandscape = false;

  public mount = (root: HTMLElement): void => {
    this.root = root;
    root.replaceChildren();
    LAYER_ORDER.forEach((name, index) => {
      const layer = h('div', { class: `layer layer-${name}`, style: { zIndex: String(10 + index * 10) } });
      layer.hidden = name !== 'controls' && name !== 'hud';
      root.appendChild(layer);
      this.layers.set(name, layer);
    });
    this.installSprites();
    this.installRotateHint();
    this.loggerService.log('ui mounted');
  };

  public layer = (name: LayerName): HTMLElement => {
    const layer = this.layers.get(name);
    if (layer == null) {
      throw new Error(`layer ${name} is not mounted`);
    }
    return layer;
  };

  /** Replaces a layer's content and shows it. */
  public show = (name: LayerName, content: HTMLElement | null): void => {
    const layer = this.layer(name);
    layer.replaceChildren();
    if (content != null) {
      layer.appendChild(content);
    }
    layer.hidden = false;
  };

  public hide = (name: LayerName): void => {
    const layer = this.layer(name);
    layer.hidden = true;
    layer.replaceChildren();
  };

  public isVisible = (name: LayerName): boolean => !this.layer(name).hidden;

  /** In battle the phone must be landscape; menus work either way. */
  public requireLandscape = (required: boolean): void => {
    this.battleWantsLandscape = required;
    this.syncRotateHint();
  };

  private installSprites(): void {
    const ui = (file: string): string => `url("${assetUrl(`/embedded/ui/${file}`)}")`;
    const vars: Record<string, string> = {
      '--ui-green-left': ui('green_left_up.png'),
      '--ui-green-middle': ui('green_middle_up.png'),
      '--ui-green-right': ui('green_right_up.png'),
      '--ui-green-left-down': ui('green_left_down.png'),
      '--ui-green-middle-down': ui('green_middle_down.png'),
      '--ui-green-right-down': ui('green_right_down.png'),
      '--ui-big-left': ui('big_left_up.png'),
      '--ui-big-center': ui('big_center_up.jpg'),
      '--ui-big-right': ui('big_right_up.png'),
      '--ui-big-left-down': ui('big_left_down.png'),
      '--ui-big-center-down': ui('big_center_down.jpg'),
      '--ui-big-right-down': ui('big_right_down.png'),
      '--ui-life-left': ui('life_left.png'),
      '--ui-life-center': ui('life_center.png'),
      '--ui-life-right': ui('life_right.png'),
      '--ui-charge-center': ui('charge_center.png'),
    };
    for (const [name, value] of Object.entries(vars)) {
      document.documentElement.style.setProperty(name, value);
    }
  }

  private installRotateHint(): void {
    this.rotateOverlay = h(
      'div',
      { class: 'rotate' },
      h('div', {}, h('div', { class: 'glyph', text: '⟳' }), h('div', { text: 'Rotate your phone to landscape' })),
    );
    this.layer('rotate').appendChild(this.rotateOverlay);
    this.layer('rotate').hidden = false;
    const sync = (): void => this.syncRotateHint();
    window.addEventListener('resize', sync);
    window.addEventListener('orientationchange', sync);
    this.syncRotateHint();
  }

  private syncRotateHint(): void {
    const portrait = window.innerHeight > window.innerWidth;
    this.rotateOverlay?.classList.toggle('is-on', portrait && this.battleWantsLandscape);
  }

  public get mounted(): boolean {
    return this.root != null;
  }
}

export default UiRootService;
