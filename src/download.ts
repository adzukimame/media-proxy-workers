import { StatusError } from './status-error.js';

export type DownloadConfig = {
  [x: string]: string | number;
  userAgent: string;
  maxSize: number;
};

export const defaultDownloadConfig: DownloadConfig = {
  userAgent: 'MisskeyMediaProxy/0.0.24',
  maxSize: 262144000,
};

export async function downloadUrl(url: URL, settings: DownloadConfig = defaultDownloadConfig): Promise<{
  contentDisposition: string | null;
  contentLength: number | null;
  buffer: ArrayBuffer;
}> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': settings.userAgent,
    },
    signal: AbortSignal.timeout(60 * 1000),
  }).catch((e: unknown) => {
    throw new StatusError('An error occured while fetching content', 500, e as Error);
  });

  if (!res.ok) {
    throw new StatusError(`Target resource could not be fetched (Received status: ${res.status})`, 404);
  }

  const contentLength = res.headers.get('content-length');
  if (contentLength !== null) {
    const size = Number(contentLength);
    if (size > settings.maxSize) {
      throw new StatusError(`Max size exceeded (${size} > ${settings.maxSize}) on response`, 400);
    }
  }

  return {
    contentDisposition: res.headers.get('content-disposition'),
    contentLength: contentLength !== null ? Number(contentLength) : null,
    buffer: await res.arrayBuffer(),
  };
}

export async function streamUrl(url: URL, settings: DownloadConfig = defaultDownloadConfig): Promise<{
  contentDisposition: string | null;
  contentLength: number | null;
  stream: ReadableStream | null;
}> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': settings.userAgent,
    },
    signal: AbortSignal.timeout(60 * 1000),
  }).catch((e: unknown) => {
    throw new StatusError('An error occured while fetching content', 500, e as Error);
  });

  if (!res.ok) {
    throw new StatusError(`Target resource could not be fetched (Received status: ${res.status})`, 404);
  }

  const contentLength = res.headers.get('content-length');
  if (contentLength !== null) {
    const size = Number(contentLength);
    if (size > settings.maxSize) {
      throw new StatusError(`Max size exceeded (${size} > ${settings.maxSize}) on response`, 400);
    }
  }

  return {
    contentDisposition: res.headers.get('content-disposition'),
    contentLength: contentLength !== null ? Number(contentLength) : null,
    stream: res.body,
  };
}
