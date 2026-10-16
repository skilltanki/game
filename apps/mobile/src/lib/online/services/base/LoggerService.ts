import { CC_ENABLE_LOGS } from '../../../../config/params';

export class LoggerService {
  public log = (...args: unknown[]): void => {
    if (!CC_ENABLE_LOGS) {
      return;
    }
    console.log('[online]', ...args);
  };

  public warn = (...args: unknown[]): void => {
    console.warn('[online]', ...args);
  };

  public error = (...args: unknown[]): void => {
    console.error('[online]', ...args);
  };
}

export default LoggerService;
