// Forwards one peer's offer / answer / ICE candidate to another. The sender
// is stamped from the socket's attachment (never from the message), the
// target must be a peer of the room, and the payload passes through as is.
import { ApiError } from '../../../../model/errors';
import type { RelayedSignalMessage, SignalMessage } from '../../../../model/protocol';
import type { RoomState } from '../../../../model/room';

export class SignalRelayService {
  public relay = (state: RoomState, fromPeerId: string, msg: SignalMessage): { to: string; message: RelayedSignalMessage } => {
    if (msg.to === fromPeerId) throw new ApiError('bad_request', 'cannot signal yourself');
    const target = state.peers.get(msg.to);
    if (target == null || !target.connected) throw new ApiError('unknown_peer');
    return { to: msg.to, message: { t: 'signal', from: fromPeerId, kind: msg.kind, payload: msg.payload } };
  };
}

export default SignalRelayService;
