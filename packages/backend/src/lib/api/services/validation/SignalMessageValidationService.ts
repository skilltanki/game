// Turns a raw socket frame into a ClientMessage, or null for anything the
// room must ignore (not JSON, unknown type, missing fields, oversized
// payload). Field by field, no schema library: the protocol is five messages.
import { CC_MAX_SIGNAL_BYTES, CC_ROOM_LIMITS } from '../../../../config/params';
import type { ClientMessage, RoomPhase, SignalKind, TeamName } from '../../../../model/protocol';

const KINDS: SignalKind[] = ['offer', 'answer', 'ice'];
const PHASES: RoomPhase[] = ['open', 'playing', 'finished'];
const TEAMS: TeamName[] = ['red', 'blue'];
const ID = /^[A-Za-z0-9_-]{1,40}$/;

export class SignalMessageValidationService {
  public parse = (raw: string | ArrayBuffer): ClientMessage | null => {
    if (typeof raw !== 'string' || raw.length > CC_MAX_SIGNAL_BYTES) return null;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
    if (msg == null || typeof msg !== 'object') return null;
    switch (msg.t) {
      case 'join': {
        if (!this.text(msg.name) || !this.id(msg.hull) || !this.id(msg.turret)) return null;
        return {
          t: 'join',
          name: (msg.name as string).trim().slice(0, CC_ROOM_LIMITS.maxNameLength),
          hull: msg.hull as string,
          turret: msg.turret as string,
          ...(this.id(msg.paint) ? { paint: msg.paint as string } : {}),
          ...(TEAMS.includes(msg.team as TeamName) ? { team: msg.team as TeamName } : {}),
          ...(typeof msg.password === 'string' ? { password: msg.password.slice(0, CC_ROOM_LIMITS.maxPasswordLength) } : {}),
          ...(typeof msg.token === 'string' && /^[0-9a-f]{32}$/.test(msg.token) ? { token: msg.token } : {}),
        };
      }
      case 'signal': {
        if (!this.id(msg.to) || !KINDS.includes(msg.kind as SignalKind) || msg.payload == null) return null;
        return { t: 'signal', to: msg.to as string, kind: msg.kind as SignalKind, payload: msg.payload };
      }
      case 'listing': {
        if (!PHASES.includes(msg.phase as RoomPhase)) return null;
        return { t: 'listing', phase: msg.phase as RoomPhase };
      }
      case 'leave':
        return { t: 'leave' };
      default:
        return null;
    }
  };

  private text(value: unknown): value is string {
    return typeof value === 'string' && value.trim() !== '';
  }

  private id(value: unknown): value is string {
    return typeof value === 'string' && ID.test(value);
  }
}

export default SignalMessageValidationService;
