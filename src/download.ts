import { StatusError } from './status-error.js';
import { parse } from 'content-disposition';

export type DownloadConfig = {
    [x: string]: any;
    userAgent: string;
    maxSize: number;
}

export const defaultDownloadConfig = {
    userAgent: `MisskeyMediaProxy/0.0.24`,
    maxSize: 262144000,
}

export async function downloadUrl(url: URL, settings: DownloadConfig = defaultDownloadConfig): Promise<{
    filename: string;
    buffer: ArrayBuffer;
}> {
    let filename = url.pathname.split('/').pop() ?? 'unknown';

    let res;

    try {
        res = await fetch(url, {
            headers: {
                'User-Agent': settings.userAgent,
            },
            signal: AbortSignal.timeout(60 * 1000),
        });
    } catch (e) {
        throw new StatusError('An error occured while fetching content', 500, e as Error);
    }

    if (!res.ok) {
        throw new StatusError(`Target resource could not be fetched (Received status: ${res.status})`, 404);
    }

    const contentLength = res.headers.get('content-length');
    if (contentLength != null) {
        const size = Number(contentLength);
        if (size > settings.maxSize) {
            throw new StatusError(`Max size exceeded (${size} > ${settings.maxSize}) on response`, 400);
        }
    }

    const contentDisposition = res.headers.get('content-disposition');
    if (contentDisposition != null) {
        try {
            const parsed = parse(contentDisposition);
            if (parsed.parameters.filename) {
                filename = parsed.parameters.filename;
            }
        } catch {
        }
    }

    return {
        filename,
        buffer: await res.arrayBuffer(),
    };
}
