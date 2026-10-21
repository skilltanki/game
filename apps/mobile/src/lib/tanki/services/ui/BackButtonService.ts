// The platform's BACK — Android's button in the TWA and the PWA, the
// browser's arrow, iOS's edge swipe — through the History API. In the start
// menu every step the player walks to is one history entry, so BACK returns to
// the step before it instead of leaving the app. BACK never closes the app
// (the owner's call): the first time the menu opens, the entry the page
// opened with becomes a floor and the menu's base is pushed above it, so a
// press on the garage lands on the floor — still this page — and is bounced
// forward to the base. In a battle `hold()` keeps one guard entry on top, so
// BACK opens the pause box (GameFacadeService), as Escape does on a desktop.
//
// MenuService drives the menu side: `open()` when the menu comes up (the current entry
// becomes the base), `sync(key)` after every draw (a new key = a new entry;
// the same key = nothing), `close()` when a battle starts. A `popstate` that
// lands on an entry of this visit calls back with its key; the menu either
// walks to that step or says it consumed the press (the rooms step going one
// view back), and then the entry it left is pushed again so the next BACK
// works the same way. An entry outside this visit (the floor, one left over
// from the visit before the battle, or one walked past while the battle was up
// and BACK pressed) is below the base: `history.forward()` until the base.
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type LoggerService from '../base/LoggerService';

const STATE_KEY = 'skilltankiBack';
/** The entry under every visit's base: BACK on the base lands here, never outside the page. */
const FLOOR = 'floor';

interface BackState {
  [STATE_KEY]?: { key: string };
}

/** What the menu does when BACK lands on `key`: true = it consumed the press and stays where it was. */
export type MenuBackHandler = (key: string) => boolean;

export class BackButtonService {
  private readonly loggerService = inject<LoggerService>(TYPES.loggerService);

  /** The keys of this visit's entries, base first; the last one is the entry on view. */
  private trail: string[] = [];
  private onBack: MenuBackHandler | null = null;
  private listening = false;
  /** The floor is laid once per page load (the first menu). */
  private floored = false;

  /** The menu is up: the current entry becomes its base (replaced, never pushed — except over the floor the first time). */
  public open = (base: string, onBack: MenuBackHandler): void => {
    this.trail = [base];
    this.onBack = onBack;
    if (this.floored) {
      history.replaceState(this.state(base), '');
    } else {
      history.replaceState(this.state(FLOOR), '');
      history.pushState(this.state(base), '');
      this.floored = true;
    }
    if (!this.listening) {
      window.addEventListener('popstate', this.onPop);
      this.listening = true;
    }
  };

  /** The menu went away (a battle): BACK is the platform's again; the entries stay and are stepped over next time. */
  public close = (): void => {
    this.onBack = null;
    this.trail = [];
    if (this.listening) {
      window.removeEventListener('popstate', this.onPop);
      this.listening = false;
    }
  };

  /**
   * One screen that must own every BACK press (a battle): `key` becomes the
   * base and a guard entry sits above it, so a press lands on the base, the
   * handler runs (and says it consumed the press) and the guard goes up again.
   */
  public hold = (key: string, onBack: MenuBackHandler): void => {
    this.open(key, onBack);
    this.sync(`${key}:guard`);
  };

  /** The step on view after a draw: a new key gets an entry, the same key nothing. */
  public sync = (key: string): void => {
    if (this.onBack == null || this.trail[this.trail.length - 1] === key) return;
    this.trail.push(key);
    history.pushState(this.state(key), '');
  };

  private readonly onPop = (e: PopStateEvent): void => {
    const onBack = this.onBack;
    if (onBack == null) return;
    const key = (e.state as BackState | null)?.[STATE_KEY]?.key;
    const index = key == null ? -1 : this.trail.lastIndexOf(key);
    if (key == null || index < 0) {
      // Below the base (the floor or a stale entry): bounce forward until the base — the app never closes on BACK.
      this.loggerService.log('back: below the base, forward', key);
      history.forward();
      return;
    }
    const left = this.trail[this.trail.length - 1];
    this.trail.length = index + 1;
    if (onBack(key)) {
      // Consumed (the rooms step went one view back): the step stays, so BACK gets the same
      // entry under it again. Through sync(): the step's redraw usually pushed it already.
      this.sync(left);
    }
  };

  private state(key: string): BackState {
    return { [STATE_KEY]: { key } };
  }
}

export default BackButtonService;
