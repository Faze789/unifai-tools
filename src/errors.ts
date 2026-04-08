/** Base error for all unifai errors. Catch this to handle any unifai failure. */
export class UnifaiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnifaiError';
  }
}

/** Thrown when the provider API returns a non-2xx HTTP status. */
export class UnifaiApiError extends UnifaiError {
  constructor(
    public readonly status: number,
    public readonly body: string,
    public readonly url: string,
  ) {
    super(`API error ${status} from ${url}: ${body}`);
    this.name = 'UnifaiApiError';
  }
}

/**
 * Thrown on HTTP 429. Extends `UnifaiApiError` so catching either works.
 * `retryAfter` is parsed from the `Retry-After` header when present.
 */
export class UnifaiRateLimitError extends UnifaiApiError {
  constructor(
    status: number,
    body: string,
    url: string,
    public readonly retryAfter?: number,
  ) {
    super(status, body, url);
    this.name = 'UnifaiRateLimitError';
    this.message = `Rate limited (${status}) by ${url}${retryAfter != null ? ` — retry after ${retryAfter}s` : ''}`;
  }
}

/** Thrown when `fetch()` itself fails (DNS, connection refused, timeout, etc.). */
export class UnifaiNetworkError extends UnifaiError {
  readonly cause?: Error;

  constructor(message: string, cause?: Error) {
    super(message);
    this.name = 'UnifaiNetworkError';
    this.cause = cause;
  }
}

/** Thrown when the API returns a response that cannot be parsed. */
export class UnifaiResponseParseError extends UnifaiError {
  constructor(
    message: string,
    public readonly rawData?: unknown,
  ) {
    super(message);
    this.name = 'UnifaiResponseParseError';
  }
}
