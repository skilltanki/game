// What the player is holding, decided from the platform's APIs and never from
// the user agent: a touch device (phone or tablet) against a desktop, and
// whether the screen is a tall phone held upright. The battle wants landscape,
// but only a phone in portrait is worth blocking with the "rotate" sheet: an
// unfolded iPhone Fold or a tablet is near-square (4:3) and plays as it is, and
// a desktop window dragged narrow is not a phone at all.
//
//   touch         `(pointer: coarse)` — the primary pointer is a finger
//   portrait      Screen Orientation API (`screen.orientation.type`), the
//                 viewport's shape where the API is missing (older Safari)
//   aspect        the physical screen's long side over its short side
//   portraitPhone touch && portrait && aspect >= PHONE_ASPECT
//
// Screen sizes (CSS px): iPhone SE 667/375 = 1.78, iPhone 15 852/393 = 2.17,
// iPad 1024/768 = 1.33, iPhone Fold open ≈ 4:3 = 1.33, its cover screen ≈ 1.41,
// Galaxy Fold open 2176/1812 = 1.20. The threshold sits between the folds
// and the narrowest phone. The screen, not the viewport: Safari's bars shrink
// innerHeight (an SE in a tab is 548/375 = 1.46) and would hide the sheet
// exactly where it is needed.

/** Long side over short side above which a touch screen counts as a phone. */
const PHONE_ASPECT = 1.5;

export class DeviceFormService {
  /** A coarse primary pointer: a phone or a tablet (a touch laptop with a mouse is a desktop). */
  public get touch(): boolean {
    return window.matchMedia('(pointer: coarse)').matches;
  }

  /** Held upright per the Screen Orientation API; the viewport's shape without it. */
  public get portrait(): boolean {
    const type = screen.orientation?.type;
    if (type != null) {
      return type.startsWith('portrait');
    }
    return window.innerHeight > window.innerWidth;
  }

  /** The physical screen's long side over its short side (1 for a square). */
  public get aspect(): number {
    const long = Math.max(screen.width, screen.height);
    const short = Math.max(1, Math.min(screen.width, screen.height));
    return long / short;
  }

  /** A tall phone held upright: the one case the battle's "rotate" sheet is for. */
  public get portraitPhone(): boolean {
    return this.touch && this.portrait && this.aspect >= PHONE_ASPECT;
  }

  /** Fires on a rotation, a fold or a window resize; returns the unsubscribe. */
  public onChange = (listener: () => void): (() => void) => {
    const orientation = screen.orientation;
    window.addEventListener('resize', listener);
    orientation?.addEventListener('change', listener);
    return () => {
      window.removeEventListener('resize', listener);
      orientation?.removeEventListener('change', listener);
    };
  };
}

export default DeviceFormService;
