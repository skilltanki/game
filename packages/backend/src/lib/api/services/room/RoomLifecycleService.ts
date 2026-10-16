// Phase and lifetime rules: who may change the phase (the host), when an
// emptied room should schedule its own deletion and when the alarm may
// really delete it.
import { ApiError } from '../../../../model/errors';
import type { RoomPhase } from '../../../../model/protocol';
import type { RoomState } from '../../../../model/room';

export class RoomLifecycleService {
  public setPhase = (state: RoomState, byPeerId: string, phase: RoomPhase, now: number): void => {
    if (state.hostId !== byPeerId) throw new ApiError('not_host');
    state.phase = phase;
    // Every `playing` re-stamps the clock's start: the host says it at START and again at the first kill (when its clock really starts).
    state.playingSince = phase === 'playing' ? now : phase === 'open' ? null : state.playingSince;
    state.updatedAt = now;
  };

  /** Nobody connected: the room lingers for the grace period, then goes. */
  public shouldPurge = (connected: number): boolean => connected === 0;
}

export default RoomLifecycleService;
