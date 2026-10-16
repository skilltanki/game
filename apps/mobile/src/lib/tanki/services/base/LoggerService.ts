import { CC_ENABLE_LOGS } from '../../../../config/params';

export class LoggerService {
  public log = (...args: unknown[]): void => {
    if (!CC_ENABLE_LOGS) {
      return;
    }
    console.log('[tanki]', ...args);
  };

  public warn = (...args: unknown[]): void => {
    console.warn('[tanki]', ...args);
  };

  public error = (...args: unknown[]): void => {
    console.error('[tanki]', ...args);
  };
}

export default LoggerService;
