export class WatcherError extends Error {
  constructor(
    readonly code: string,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = 'WatcherError';
  }
}

export function getSafeWatcherError(error: unknown): string {
  return error instanceof WatcherError ? error.code : 'WATCHER_SOURCE_FAILED';
}
