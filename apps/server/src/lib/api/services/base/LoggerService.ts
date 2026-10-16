// Structured console logging with a service prefix. Workers keep console
// output in the dashboard / `wrangler tail`; there is no file to append to.
export class LoggerService {
  public log = (scope: string, message: string, data?: Record<string, unknown>): void => {
    console.log(`[api] ${scope}: ${message}`, data ?? '');
  };

  public warn = (scope: string, message: string, data?: Record<string, unknown>): void => {
    console.warn(`[api] ${scope}: ${message}`, data ?? '');
  };

  public error = (scope: string, message: string, error: unknown): void => {
    console.error(`[api] ${scope}: ${message}`, error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : error);
  };
}

export default LoggerService;
