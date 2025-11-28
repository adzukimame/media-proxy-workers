import { Buffer } from 'node:buffer';

import sjson from 'secure-json-parse';
import { Hono } from 'hono';
import { StatusCode } from 'hono/utils/http-status';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod/v4-mini';
import _contentDisposition, { parse as parseContentDisposition } from 'content-disposition';

import { FILE_TYPE_BROWSERSAFE } from './const.js';
import { detectStreamType, detectType } from './file-info.js';
import { StatusError } from './status-error.js';
import { defaultDownloadConfig, downloadUrl, streamUrl } from './download.js';
import { convertToStatic } from './convert.js';
import { ConvertPngToStaticStream, ConvertWebpToStaticStream } from './convert-stream.js';

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export interface Env extends Record<string, unknown> {
  ENV?: string;
  AVATAR_REDIRECT_ENABLED?: boolean;
  AVATAR_REDIRECT_HOST?: string;
  CLOUD_LOGGING_ENABLED?: boolean;
  CLOUD_LOGGING_LOGNAME?: string;
  CLOUD_LOGGING_NAMESPACE?: string;
  CLOUD_LOGGING_CREDENTIAL_JSON?: string;
}

export const app = new Hono<{
  Bindings: Env;
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
  // eslint-disable-next-line @stylistic/quotes
  ctx.header('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; sandbox;");

  const secFetchSite = ctx.req.header('sec-fetch-site');
  const secFetchMode = ctx.req.header('sec-fetch-mode');
  const secFetchDest = ctx.req.header('sec-fetch-dest');

  if (secFetchSite === 'cross-site') {
    if (
      ctx.req.method === 'GET'
      && secFetchMode === 'navigate'
      && (secFetchDest === 'document' || secFetchDest === 'empty')
    ) {
      // nop
    }
    else if (
      ctx.req.method === 'GET'
      && secFetchMode === 'no-cors'
      && secFetchDest === 'image'
      && ctx.req.path === '/favicon.ico'
    ) {
      // nop
    }
    else {
      ctx.header('Cache-Control', 'private, no-store');
      return ctx.body(null, 400);
    }
  }

  await next();
  return;
});

app.get('/favicon.ico', (ctx) => {
  ctx.header('Cache-Control', 'public, max-age=31536000, immutable');
  return ctx.body(null, 204);
});

const requestValidator = zValidator(
  'query',
  z.object({ url: z.url() }),
  ({ success }) => { if (!success) throw new StatusError('URL is required', 400); }
);

app.get('*', requestValidator, async (ctx) => {
  const proxyUrl = new URL(ctx.req.valid('query').url);

  const userAgent = ctx.req.header('User-Agent');
  if (userAgent === defaultDownloadConfig.userAgent) {
    ctx.header('Cache-Control', 'private, no-store');
    return ctx.body(null, 400);
  }

  const requestHost = ctx.req.header('Host');
  if (requestHost && proxyUrl.host === requestHost) {
    ctx.header('Cache-Control', 'private, no-store');
    return ctx.body(null, 400);
  }

  if (proxyUrl.host === ctx.env.AVATAR_REDIRECT_HOST && proxyUrl.pathname.startsWith('/avatar/') && ctx.env.AVATAR_REDIRECT_ENABLED) {
    const loc = await fetch(proxyUrl, {
      redirect: 'manual',
      headers: {
        'User-Agent': defaultDownloadConfig.userAgent,
      },
      signal: AbortSignal.timeout(60 * 1000),
    }).then((rdr) => {
      const loc = rdr.headers.get('Location');

      if (rdr.status < 300 || rdr.status >= 400 || loc === null) {
        throw new StatusError(`Target resource could not be fetched (avatar image url, received status: ${rdr.status})`, 404);
      }

      return loc;
    }).catch((e: unknown) => {
      if (e instanceof StatusError) {
        throw e;
      }
      else {
        throw new StatusError('An error occured while fetching content (avatar image url)', 500, e as Error);
      }
    });

    ctx.header('Cache-Control', 'public, immutable, max-age=604800');
    return ctx.redirect(loc, 302);
  }

  if (ctx.req.query('static') === undefined && ctx.req.query('preview') === undefined && ctx.req.query('badge') === undefined) {
    const file = await streamUrl(proxyUrl);

    const { mime, ext, data: streamWithFileType } = await detectStreamType(file.data);

    if (mime === 'image/svg+xml') {
      throw new StatusError(`Rejected type (${mime})`, 403);
    }
    else if (!(mime.startsWith('image/') || FILE_TYPE_BROWSERSAFE.includes(mime))) {
      throw new StatusError(`Rejected type (${mime})`, 403);
    }

    ctx.header('Content-Type', mime);
    ctx.header('Cache-Control', 'public, max-age=31536000, immutable');

    let filename = proxyUrl.pathname.split('/').pop() ?? 'unknown';
    if (file.contentDisposition !== null) {
      try {
        const parsed = parseContentDisposition(file.contentDisposition);
        if (parsed.parameters['filename']) {
          filename = parsed.parameters['filename'];
        }
      }
      catch {
        // nop
      }
    }
    ctx.header('Content-Disposition',
      contentDisposition(
        'inline',
        correctFilename(filename, ext)
      )
    );

    if (file.contentLength !== null) ctx.header('Content-Length', file.contentLength.toString());

    if (streamWithFileType === null) {
      return ctx.body(null, 204);
    }
    else {
      return ctx.body(streamWithFileType as ReadableStream, 200);
    }
  }

  const file = await streamUrl(proxyUrl);
  const { mime, ext, data: streamWithFileType } = await detectStreamType(file.data);

  if (mime === 'image/svg+xml') {
    throw new StatusError(`Rejected type (${mime})`, 403);
  }
  else if (!(mime.startsWith('image/') || FILE_TYPE_BROWSERSAFE.includes(mime))) {
    throw new StatusError(`Rejected type (${mime})`, 403);
  }

  ctx.header('Content-Type', mime);
  ctx.header('Cache-Control', 'public, max-age=31536000, immutable');

  let filename = proxyUrl.pathname.split('/').pop() ?? 'unknown';
  if (file.contentDisposition !== null) {
    try {
      const parsed = parseContentDisposition(file.contentDisposition);
      if (parsed.parameters['filename']) {
        filename = parsed.parameters['filename'];
      }
    }
    catch {
      // nop
    }
  }
  ctx.header('Content-Disposition',
    contentDisposition(
      'inline',
      correctFilename(filename, ext)
    )
  );

  // ctx.header('Content-Length', file.buffer.byteLength.toString());

  if (streamWithFileType === null) {
    return ctx.body(null, 204);
  }
  else if (mime === 'image/webp') {
    if (file.contentLength !== null) ctx.header('Content-Length', file.contentLength.toString());
    return ctx.body(streamWithFileType.pipeThrough(new ConvertWebpToStaticStream()) as ReadableStream);
  }
  else if (mime === 'image/apng') {
    return ctx.body(streamWithFileType.pipeThrough(new ConvertPngToStaticStream()) as ReadableStream);
  }
  else {
    return ctx.body(streamWithFileType as ReadableStream);
  }
});

const cloudLoggingCredentialSchema = z.object({
  private_key: z.string(),
  private_key_id: z.string(),
  client_email: z.string(),
  project_id: z.string(),
});

app.onError(async (err, ctx) => {
  if (ctx.env.CLOUD_LOGGING_ENABLED && ctx.env.CLOUD_LOGGING_CREDENTIAL_JSON) {
    const serviceAccountParseResult = cloudLoggingCredentialSchema.safeParse(sjson.parse(ctx.env.CLOUD_LOGGING_CREDENTIAL_JSON));

    if (serviceAccountParseResult.success) {
      const serviceAccount = serviceAccountParseResult.data;
      const pemContents = serviceAccount.private_key.replace(/^[^\n]+\n/, '').replace(/[^\n]+\n$/, '').replaceAll('\n', '');
      const privateKey = await crypto.subtle.importKey(
        'pkcs8',
        Buffer.from(pemContents, 'base64'),
        {
          name: 'RSASSA-PKCS1-v1_5',
          hash: { name: 'SHA-256' },
        },
        false,
        ['sign']
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

      await fetch(
        'https://logging.googleapis.com/v2/entries:write',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            logName: ctx.env.CLOUD_LOGGING_LOGNAME ?? `projects/${serviceAccount.project_id}/logs/media-proxy-access`,
            resource: {
              type: 'generic_task',
              labels: {
                project_id: serviceAccount.project_id,
                location: 'cloudflare-workers',
                namespace: ctx.env.CLOUD_LOGGING_NAMESPACE ?? 'production',
                job: 'media-proxy',
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
                  error: {
                    name: err.name,
                    message: err.message,
                    stack: err.stack,
                    cause: err.cause,
                  },
                  originalError: err instanceof StatusError && err.origin ? err.origin.toString() : undefined,
                },
              },
            ],
          }),
        }
      );
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
    if (cache != undefined && env.ENV !== 'development') {
      return cache;
    }

    const res = await app.fetch(request, env, ctx);

    if (request.method === 'GET' && env.ENV !== 'development') {
      await caches.default.put(request, res.clone());
    }

    return res;
  },
};

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
