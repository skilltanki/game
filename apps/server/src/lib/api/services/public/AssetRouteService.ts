// /assets/* from the R2 bucket — the one asset path, identical in dev
// (workerd's local bucket, seeded with `npm run upload-assets -- --local`)
// and in production (the real bucket, `npm run upload-assets`). Objects are
// immutable under their key (a changed file is re-uploaded under the same
// key and the PWA retires its cache by CC_ASSET_CACHE_VERSION), so the
// response is cacheable for a year; the ETag is the object's md5 and an
// If-None-Match hit costs no body.
import type { Env } from '../../../../env';

const PREFIX = '/assets/';

const TYPES: Record<string, string> = {
  json: 'application/json',
  xml: 'application/xml',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  '3ds': 'application/octet-stream',
};

export class AssetRouteService {
  /** Dev seeding (CC_DEV_SEED): writes the request body into the local bucket under `key`. */
  public store = async (env: Env, key: string, request: Request): Promise<Response> => {
    if (key === '' || key.includes('..')) {
      return new Response('bad key', { status: 400 });
    }
    const contentType = request.headers.get('Content-Type') ?? TYPES[key.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
    const body = await request.arrayBuffer();
    const object = await env.ASSETS.put(key, body, { httpMetadata: { contentType } });
    return Response.json({ ok: true, key, size: body.byteLength, etag: object.httpEtag });
  };

  public serve = async (env: Env, request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(PREFIX)) {
      return new Response('not found', { status: 404 });
    }
    const key = decodeURIComponent(url.pathname.slice(PREFIX.length));
    if (key === '' || key.includes('..')) {
      return new Response('not found', { status: 404 });
    }
    const object = request.method === 'HEAD' ? await env.ASSETS.head(key) : await env.ASSETS.get(key);
    if (object == null) {
      return new Response('not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
    }
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', TYPES[key.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream');
    }
    headers.set('ETag', object.httpEtag);
    headers.set('Content-Length', String(object.size));
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    if (request.headers.get('If-None-Match') === object.httpEtag) {
      return new Response(null, { status: 304, headers });
    }
    const body = 'body' in object ? (object as R2ObjectBody).body : null;
    return new Response(request.method === 'HEAD' ? null : body, { status: 200, headers });
  };
}

export default AssetRouteService;
