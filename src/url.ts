const MAX_URL_LENGTH = 2_048;

export class InvalidUrlError extends Error {
  readonly code = 'INVALID_URL';

  constructor(options?: ErrorOptions) {
    super('INVALID_URL', options);
    this.name = 'InvalidUrlError';
  }
}

export function normalizeHttpUrl(input: string, base?: string): string {
  if (input.length === 0 || input.length > MAX_URL_LENGTH) {
    throw new InvalidUrlError();
  }

  let url: URL;
  try {
    url = base ? new URL(input, base) : new URL(input);
  } catch {
    throw new InvalidUrlError();
  }

  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username.length > 0 ||
    url.password.length > 0
  ) {
    throw new InvalidUrlError();
  }

  url.hash = '';
  return url.toString();
}
