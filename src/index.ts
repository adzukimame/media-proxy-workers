import { Buffer } from 'node:buffer';
import { FILE_TYPE_BROWSERSAFE } from './const.js';
import { Hono, Context as HonoContext } from 'hono';
import { detectType } from './file-info.js';
import { StatusError } from './status-error.js';
import { defaultDownloadConfig, downloadUrl } from './download.js';
import _contentDisposition from 'content-disposition';
import { StatusCode } from 'hono/utils/http-status';
import { convertToStatic } from './convert.js';

export interface Env extends Record<string, unknown> {
    ENV?: string,
    AVATAR_REDIRECT_ENABLED?: boolean,
    AVATAR_REDIRECT_HOST?: string,
    CLOUD_LOGGING_ENABLED?: boolean,
    CLOUD_LOGGING_LOGNAME?: string,
    CLOUD_LOGGING_CREDENTIAL_JSON?: string,
}

const app = new Hono<{
    Bindings: Env,
}>();

app.use(async (ctx, next) => {
    ctx.header('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet, noimageindex, noai, noimageai');
    ctx.header('Cross-Origin-Opener-Policy', 'same-origin');
    ctx.header('Cross-Origin-Resource-Policy', 'same-site');
    ctx.header('Origin-Agent-Cluster', '?1');
    ctx.header('Referrer-Policy', 'same-origin');
    ctx.header('X-Content-Type-Options', 'nosniff');
    ctx.header('X-Frame-Options', 'DENY');
    ctx.header('X-XSS-Protection', '0');
    ctx.header('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; sandbox;");
    await next();
});

app.get('*', async (ctx) => {
    if (ctx.req.path === '/favicon.ico') {
        ctx.header('Cache-Control', 'public, max-age=31536000, immutable');
        return ctx.body(null, 204);
    }

    let proxyUrl: URL | string | undefined = ctx.req.query('url');

    if (proxyUrl === undefined || !URL.canParse(proxyUrl)) {
        throw new StatusError('URL is required', 400);
    }

    proxyUrl = new URL(proxyUrl);

    if (proxyUrl.host === ctx.env.AVATAR_REDIRECT_HOST && proxyUrl.pathname.startsWith('/avatar/') && ctx.env.AVATAR_REDIRECT_ENABLED) {
        let rdr;
        try {
            rdr = await fetch(proxyUrl, {
                redirect: 'manual',
                headers: {
                    'User-Agent': defaultDownloadConfig.userAgent,
                },
                signal: AbortSignal.timeout(60 * 1000),
            });
        } catch (e) {
            throw new StatusError('An error occured while fetching content (avatar image url)', 500, e as Error);
        }

        const loc = rdr.headers.get('Location');

        if (rdr.status < 300 || rdr.status >= 400 || loc === null) {
            throw new StatusError(`Target resource could not be fetched (avatar image url, received status: ${rdr.status})`, 404);
        }

        ctx.header('Cache-Control', 'public, immutable, max-age=604800');
        return ctx.redirect(loc, 302);
    }

    // Create temp file
    let file = await downloadAndDetectTypeFromUrl(proxyUrl);

    if (ctx.req.query('static') !== undefined || ctx.req.query('preview') !== undefined || ctx.req.query('badge') !== undefined) {
        file = convertToStatic(file);
    }

    if (file.mime === 'image/svg+xml') {
        throw new StatusError(`Rejected type (${file.mime})`, 403);
    } else if (!(file.mime.startsWith('image/') || FILE_TYPE_BROWSERSAFE.includes(file.mime))) {
        throw new StatusError(`Rejected type (${file.mime})`, 403);
    }

    ctx.header('Content-Type', file.mime);
    ctx.header('Cache-Control', 'public, max-age=31536000, immutable');
    ctx.header('Content-Disposition',
        contentDisposition(
            'inline',
            correctFilename(file.filename, file.ext)
        )
    );
    ctx.header('Content-Length', file.buffer.byteLength.toString());

    return ctx.body(file.buffer);
});

app.onError(async (err, ctx) => {
    if (ctx.env.ENV !== 'production') {
        console.log(err);
    }

    if (ctx.env.CLOUD_LOGGING_ENABLED && ctx.env.CLOUD_LOGGING_CREDENTIAL_JSON) {
        const serviceAccount = JSON.parse(ctx.env.CLOUD_LOGGING_CREDENTIAL_JSON);
        const pemContents = serviceAccount.private_key.replace(/^[^\n]+\n/, '').replace(/[^\n]+\n$/, '').replaceAll('\n', '');
        const privateKey = await crypto.subtle.importKey(
            'pkcs8',
            Buffer.from(pemContents, 'base64'),
            {
                name: 'RSASSA-PKCS1-v1_5',
                hash: {
                    name: 'SHA-256',
                },
            },
            false,
            ['sign'],
        );

        const iat = Math.floor(Date.now() / 1000);
        const tokenHeader = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: serviceAccount.private_key_id }), 'utf8').toString('base64url');
        const tokenPayload = Buffer.from(JSON.stringify({ iss: serviceAccount.client_email, sub: serviceAccount.client_email, aud: 'https://logging.googleapis.com/', exp: iat + 3600, iat }), 'utf8').toString('base64url');
        const tokenSignature = Buffer.from(
            await crypto.subtle.sign(
                { name: 'RSASSA-PKCS1-v1_5' },
                privateKey,
                new TextEncoder().encode(`${tokenHeader}.${tokenPayload}`)
            )
        ).toString('base64url');
        const token = `${tokenHeader}.${tokenPayload}.${tokenSignature}`;

        const res = await fetch(
            'https://logging.googleapis.com/v2/entries:write',
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    logName: ctx.env.CLOUD_LOGGING_LOGNAME ?? `projects/${serviceAccount.project_id}/logs/misskey-media-proxy`,
                    resource: {
                        type: 'generic_task',
                        labels: {
                            project_id: serviceAccount.project_id,
                            location: 'cloudflare-workers',
                            namespace: 'misskey-media-proxy',
                            job: 'misskey-media-proxy',
                            task_id: ctx.req.header('Cf-Ray'),
                        },
                    },
                    entries: [
                        {
                            timestamp: new Date().toISOString(),
                            severity: 'error',
                            httpRequest: {
                                requestMethod: ctx.req.method,
                                requestUrl: ctx.req.url,
                                status: err instanceof StatusError && err.isClientError ? 400 : 500,
                                userAgent: ctx.req.header('User-Agent'),
                                remoteIp: ctx.req.header('Cf-Connecting-IP'),
                                referer: ctx.req.header('Referer'),
                                protocol: ctx.req.raw.cf?.httpProtocol,
                            },
                            jsonPayload: {
                                rayId: ctx.req.header('Cf-Ray'),
                                xForwardedFor: ctx.req.header('X-Forwarded-For'),
                                country: ctx.req.raw.cf?.country,
                                proxyUrl: ctx.req.query('url'),
                                error: err?.toString(),
                                originalError: err instanceof StatusError && err.origin ? err.origin.toString() : undefined,
                            },
                        },
                    ],
                }),
            }
        );

        if (!res.ok && ctx.env.ENV !== 'production') {
            console.log('Logging failed.');
            console.log(await res.text());
        }
    }

    ctx.header('Cache-Control', 'public, max-age=300');

    if (ctx.req.query('fallback') !== undefined) {
        const assets = await import('./assets.js');
        ctx.header('Content-Type', 'image/webp');
        return ctx.body(Buffer.from(assets.dummy, 'base64'), 404);
    }

    if (err instanceof StatusError && err.isClientError) {
        return ctx.body(null, err.statusCode as StatusCode);
    }

    return ctx.body(null, 500);
});

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext) {
        const cache = await caches.default.match(request, { ignoreMethod: true });
        if (cache != undefined && env.ENV === 'production') {
            return cache;
        }

        const secFetchSite = request.headers.get('sec-fetch-site');
        const secFetchMode = request.headers.get('sec-fetch-mode');
        const secFetchDest = request.headers.get('sec-fetch-dest');

        if (secFetchSite === 'cross-site') {
            if (request.method === 'GET' && secFetchMode === 'navigate' && secFetchDest === 'document') {
            } else if (request.method === 'GET' && secFetchMode === 'navigate' && secFetchDest === 'empty') {
            } else {
                return new Response(null, {
                    status: 400,
                    headers: {
                        'Cache-Control': 'private',
                        'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet, noimageindex, noai, noimageai',
                        'Cross-Origin-Opener-Policy': 'same-origin',
                        'Origin-Agent-Cluster': '?1',
                        'Referrer-Policy': 'same-origin',
                        'X-Content-Type-Options': 'nosniff',
                        'X-Frame-Options': 'DENY',
                        'X-XSS-Protection': '0',
                        'Content-Security-Policy': "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; sandbox;",
                    },
                });
            }
        }

        const res = await app.fetch(request, env, ctx);

        if (request.method === 'GET' && env.ENV === 'production') {
            await caches.default.put(request, res.clone());
        }

        return res;
    }
}

async function downloadAndDetectTypeFromUrl(url: URL): Promise<
    { mime: string; ext: string | null; filename: string; buffer: ArrayBuffer }
> {
    try {
        const { filename, buffer } = await downloadUrl(url);

        const { mime, ext } = await detectType(buffer);

        return {
            mime,
            ext,
            filename: correctFilename(filename, ext),
            buffer,
        }
    } catch (e) {
        throw e;
    }
}

function correctFilename(filename: string, ext: string | null) {
    const dotExt = ext ? `.${ext}` : '.unknown';
    if (filename.endsWith(dotExt)) {
        return filename;
    }
    if (ext === 'jpg' && filename.endsWith('.jpeg')) {
        return filename;
    }
    if (ext === 'tif' && filename.endsWith('.tiff')) {
        return filename;
    }
    return `${filename}${dotExt}`;
}

function contentDisposition(type: 'inline' | 'attachment', filename: string): string {
    const fallback = filename.replace(/[^\w.-]/g, '_');
    return _contentDisposition(filename, { type, fallback });
}
