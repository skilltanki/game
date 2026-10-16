// Structured logging with a service prefix: the console always (pm2 / docker
// keep it), plus a rotated file ./logs/backend-<key>.log (pinolog) when
// CC_ENABLE_LOGS is set. The key tells the processes of one bootstrap apart.
import { createLogger } from 'pinolog';
import { singleshot } from 'functools-kit';
import { CC_ENABLE_LOGS } from '../../../../config/params';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type BootstrapService from './BootstrapService';

export class LoggerService {
  private readonly bootstrapService = inject<BootstrapService>(TYPES.bootstrapService);

  private readonly file = singleshot(() => (CC_ENABLE_LOGS ? createLogger(`backend-${this.bootstrapService.getLoggerKey()}.log`) : null));

  public log = (scope: string, message: string, data?: Record<string, unknown>): void => {
    console.log(`[backend] ${scope}: ${message}`, data ?? '');
    this.file()?.log(`${scope}: ${message}`, data ?? {});
  };

  public warn = (scope: string, message: string, data?: Record<string, unknown>): void => {
    console.warn(`[backend] ${scope}: ${message}`, data ?? '');
    this.file()?.log(`WARN ${scope}: ${message}`, data ?? {});
  };

  public error = (scope: string, message: string, error: unknown): void => {
    const detail = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { error };
    console.error(`[backend] ${scope}: ${message}`, detail);
    this.file()?.log(`ERROR ${scope}: ${message}`, detail);
  };
}

export default LoggerService;
