// The ControlSource of a replica: the owner's commands arrive over the mesh
// and are pushed into the actor's CommandBuffer, stamped with THIS machine's
// current tick (the peers' clocks are not aligned, so the sender's tick is
// only a sequence number). CLAUDE.md rule 4: a replica is driven through the
// same TankCommand → CommandBuffer → TankDriverService path as everyone.
import type { CommandSink, ControlSource, ControlSourceEnv } from '../../../../model/ControlSource';
import { cloneCommand, IDLE_COMMAND, type TankCommand } from '../../../../model/TankCommand';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type LoggerService from '../base/LoggerService';

interface Inbox {
  sink: CommandSink;
  env: ControlSourceEnv;
  /** Sequence of the last command applied; an older one out of order is dropped. */
  lastSeq: number;
}

export class RemoteControlService {
  private readonly loggerService = inject<LoggerService>(TYPES.loggerService);

  private readonly inboxes = new Map<string, Inbox>();

  /** A source for the actor whose id is `peerId`; it starts delivering once the battle attaches it. */
  public createSource = (peerId: string): ControlSource => {
    const self = this;
    return {
      kind: 'remote',
      async start(sink: CommandSink, env: ControlSourceEnv): Promise<void> {
        self.inboxes.set(peerId, { sink, env, lastSeq: -1 });
        self.loggerService.log('remote source attached', peerId);
      },
      stop(): void {
        self.inboxes.delete(peerId);
      },
    };
  };

  /** A command from the owner of `peerId`'s tank. */
  public deliver = (peerId: string, seq: number, command: TankCommand): void => {
    const inbox = this.inboxes.get(peerId);
    if (inbox == null) return;
    if (seq < inbox.lastSeq) return;
    inbox.lastSeq = seq;
    const cmd = cloneCommand(command);
    // Presentation never crosses the wire; the owner's camera is its own.
    cmd.cameraTilt = 0;
    inbox.sink.push(cmd, inbox.env.currentTick());
  };

  /** The owner went quiet: the replica lets go of everything (otherwise the buffer repeats the last command forever). */
  public idle = (peerId: string): void => {
    const inbox = this.inboxes.get(peerId);
    if (inbox == null) return;
    inbox.sink.push(cloneCommand(IDLE_COMMAND), inbox.env.currentTick());
  };

  public has = (peerId: string): boolean => this.inboxes.has(peerId);

  public dispose = (): void => {
    this.inboxes.clear();
  };
}

export default RemoteControlService;
