// What the Durable Object's alarm and its join-time prune did, as one
// periodic sweep in ONE process (the `--firstPort` child, or the single
// process): seats whose process died (no heartbeat, so no close ever came)
// are let go, peers whose rejoin window closed are dropped, a room empty
// for longer than the grace is purged (Redis state, lobby entry, journal
// closed), stale and run-out listings are forgotten.
import { readParams } from '../../../../config/params';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type LoggerService from '../base/LoggerService';
import type ClockService from '../base/ClockService';
import type RoomMembershipService from '../room/RoomMembershipService';
import type RoomStoreService from '../store/RoomStoreService';
import type LobbyIndexService from '../store/LobbyIndexService';
import type RoomRecordService from '../store/RoomRecordService';
import type RoomSessionService from './RoomSessionService';

// A second: the purge after the empty grace lands within a second of it (the Worker had an exact alarm).
const SWEEP_EVERY_MS = 1000;

export class RoomSweepService {
  private readonly loggerService = inject<LoggerService>(TYPES.loggerService);
  private readonly clockService = inject<ClockService>(TYPES.clockService);
  private readonly roomMembershipService = inject<RoomMembershipService>(TYPES.roomMembershipService);
  private readonly roomStoreService = inject<RoomStoreService>(TYPES.roomStoreService);
  private readonly lobbyIndexService = inject<LobbyIndexService>(TYPES.lobbyIndexService);
  private readonly roomRecordService = inject<RoomRecordService>(TYPES.roomRecordService);
  private readonly roomSessionService = inject<RoomSessionService>(TYPES.roomSessionService);

  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  public start = (): void => {
    if (this.timer != null) return;
    this.timer = setInterval(() => void this.tick(), SWEEP_EVERY_MS);
    this.loggerService.log('roomSweepService', 'started', { everyMs: SWEEP_EVERY_MS });
  };

  public stop = (): void => {
    if (this.timer != null) clearInterval(this.timer);
    this.timer = null;
  };

  /** One pass over every room on record. */
  public tick = async (): Promise<void> => {
    if (this.running) return;
    this.running = true;
    try {
      const now = this.clockService.now();
      const { emptyGraceMs, rejoinTtlMs } = readParams();
      for (const id of await this.lobbyIndexService.ids()) {
        await this.roomStoreService.withLock(id, async () => {
          const state = await this.roomStoreService.load(id);
          if (state == null) {
            await this.lobbyIndexService.remove(id);
            return;
          }
          const reaped = await this.roomSessionService.reapDeadSockets(id, state, now);
          const pruned = this.roomMembershipService.prune(state, now, rejoinTtlMs);
          const connected = this.roomSessionService.connected(state);
          let changed = reaped || pruned.length > 0;
          if (connected === 0 && state.emptySince == null) {
            state.emptySince = now;
            changed = true;
          }
          if (connected === 0 && state.emptySince != null && now - state.emptySince > emptyGraceMs) {
            await this.roomStoreService.delete(id);
            await this.lobbyIndexService.remove(id);
            this.roomRecordService.purged(id, now);
            this.loggerService.log('roomSweepService', 'room purged', { id });
            return;
          }
          if (changed) {
            await this.roomStoreService.save(state);
            await this.roomSessionService.publishListing(state, now);
            this.roomRecordService.record(state, connected, now);
            if (pruned.length > 0) this.loggerService.log('roomSweepService', 'peers pruned', { id, pruned });
          }
        });
      }
      const gone = await this.lobbyIndexService.sweep(now);
      if (gone.length > 0) this.loggerService.log('roomSweepService', 'listings swept', { gone });
    } catch (error) {
      this.loggerService.error('roomSweepService', 'sweep failed', error);
    } finally {
      this.running = false;
    }
  };
}

export default RoomSweepService;
