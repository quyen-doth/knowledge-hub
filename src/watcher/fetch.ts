import { WatcherError } from './errors';

export const SOURCE_FETCH_TIMEOUT_MS = 15_000;
export const MAX_SOURCE_RESPONSE_BYTES = 2_000_000;
export const WATCHER_USER_AGENT = 'KnowledgeHubBot/1.0 (+contact)';

interface FetchSourceOptions {
  fetcher: typeof fetch;
  accept: string;
  userAgent?: string;
  timeoutMs?: number;
  maxBytes?: number;
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new WatcherError('SOURCE_RESPONSE_TOO_LARGE');
  }

  if (!response.body) {
    return '';
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = '';

  while (true) {
    const result = await reader.read();
    if (result.done) {
      return text + decoder.decode();
    }

    totalBytes += result.value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new WatcherError('SOURCE_RESPONSE_TOO_LARGE');
    }

    text += decoder.decode(result.value, { stream: true });
  }
}

export async function fetchSourceText(
  url: string,
  options: FetchSourceOptions,
): Promise<string> {
  let response: Response;
  try {
    response = await options.fetcher(url, {
      headers: {
        accept: options.accept,
        ...(options.userAgent ? { 'user-agent': options.userAgent } : {}),
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(options.timeoutMs ?? SOURCE_FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    throw new WatcherError('SOURCE_FETCH_FAILED', { cause: error });
  }

  if (!response.ok) {
    throw new WatcherError(`SOURCE_HTTP_${response.status}`);
  }

  return readBoundedText(response, options.maxBytes ?? MAX_SOURCE_RESPONSE_BYTES);
}
