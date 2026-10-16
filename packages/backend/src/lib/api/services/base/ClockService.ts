// The clock behind one door, so time-based rules (stale listings, rejoin
// TTL, empty-room grace) read one source and tests can reason about it.
export class ClockService {
  public now = (): number => Date.now();
}

export default ClockService;
