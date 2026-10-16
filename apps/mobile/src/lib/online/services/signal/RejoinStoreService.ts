// The seat ticket that outlives the page: the room, the peerId and the
// rejoin token of the last room joined, in localStorage. A player whose tab
// died mid-battle (a reload, a crash, the phone's browser evicting the page)
// comes back to the SAME seat — the tank a bot has been driving meanwhile —
// instead of a fresh one, as long as the server's rejoin window
// (CC_REJOIN_TTL_MS) is still open. An explicit leave forgets it.
import { CC_STORAGE_PREFIX } from '../../../../config/params';

const KEY = `${CC_STORAGE_PREFIX}rejoin`;

export interface RejoinTicket {
  roomId: string;
  peerId: string;
  token: string;
  /** When it was written (ms since the epoch), for the log. */
  at: number;
}

export class RejoinStoreService {
  /** The seat just taken (or taken back): the next join of this room uses its token. */
  public remember = (ticket: Omit<RejoinTicket, 'at'>): void => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...ticket, at: Date.now() } satisfies RejoinTicket));
    } catch {
      // Private mode, quota: the seat is simply not remembered.
    }
  };

  /** The ticket for `roomId`, if that is the room last sat in. */
  public recall = (roomId: string): RejoinTicket | null => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw == null) return null;
      const ticket = JSON.parse(raw) as Partial<RejoinTicket>;
      if (ticket.roomId !== roomId || typeof ticket.token !== 'string' || typeof ticket.peerId !== 'string') return null;
      return { roomId, peerId: ticket.peerId, token: ticket.token, at: typeof ticket.at === 'number' ? ticket.at : 0 };
    } catch {
      return null;
    }
  };

  /** The seat was given up (or the server refused the ticket): nothing to come back to. */
  public forget = (roomId: string): void => {
    try {
      if (this.recall(roomId) != null) localStorage.removeItem(KEY);
    } catch {
      // Nothing to forget.
    }
  };
}

export default RejoinStoreService;
