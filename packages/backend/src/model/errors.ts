// The one error type the API answers with. Routes map it to
// { status: 'error', code } with the HTTP status; the signalling socket sends
// it as an `error` message. Anything else is a 500 and goes to the log.

export type ApiErrorCode =
  | 'bad_request'
  | 'room_not_found'
  | 'room_full'
  | 'bad_password'
  | 'bad_token'
  | 'finished'
  | 'not_host'
  | 'unknown_peer';

const STATUS: Record<ApiErrorCode, number> = {
  bad_request: 400,
  room_not_found: 404,
  room_full: 409,
  bad_password: 403,
  bad_token: 403,
  finished: 410,
  not_host: 403,
  unknown_peer: 404,
};

export class ApiError extends Error {
  readonly status: number;

  constructor(
    readonly code: ApiErrorCode,
    message: string = code,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = STATUS[code];
  }

  static is(error: unknown): error is ApiError {
    return error instanceof ApiError;
  }
}
