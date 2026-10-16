// /assets/* — the game data from the MinIO bucket, the one asset path the
// client knows (the same tree the Worker serves from R2). Objects are
// immutable under their key (a changed file is re-uploaded under the same
// key and the PWA retires its cache by CC_ASSET_CACHE_VERSION), so the
// response is cacheable for a year; the ETag is the object's md5 and an
// If-None-Match hit costs no body. PUT /__dev/assets/* (dev only) seeds the
// bucket the way the Worker's dev route did.
import { Readable } from 'node:stream';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type AssetStorageService from '../store/AssetStorageService';

const PREFIX = '/assets/';

const TYPES_BY_EXT: Record<string, string> = {
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

export function contentTypeOf(key: string): string {
  return TYPES_BY_EXT[key.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
}

export class AssetRouteService {
  private readonly assetStorageService = inject<AssetStorageService>(TYPES.assetStorageService);

  public serve = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(PREFIX)) {
      return new Response('not found', { status: 404 });
    }
    const key = decodeURIComponent(url.pathname.slice(PREFIX.length));
    if (key === '' || key.includes('..')) {
      return new Response('not found', { status: 404 });
    }
    const stat = await this.assetStorageService.stat(key);
    if (stat == null) {
      return new Response('not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
    }
    const headers = new Headers();
    headers.set('Content-Type', stat.contentType ?? contentTypeOf(key));
    headers.set('ETag', stat.etag);
    headers.set('Content-Length', String(stat.size));
    headers.set('Last-Modified', stat.lastModified.toUTCString());
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    if (request.headers.get('If-None-Match') === stat.etag) {
      return new Response(null, { status: 304, headers });
    }
    if (request.method === 'HEAD') {
      return new Response(null, { status: 200, headers });
    }
    const stream = await this.assetStorageService.get(key);
    return new Response(Readable.toWeb(stream) as ReadableStream, { status: 200, headers });
  };

  /** Dev seeding: writes the request body into the bucket under `key`. */
  public store = async (key: string, request: Request): Promise<Response> => {
    if (key === '' || key.includes('..')) {
      return new Response('bad key', { status: 400 });
    }
    const contentType = request.headers.get('Content-Type') ?? contentTypeOf(key);
    const body = Buffer.from(await request.arrayBuffer());
    const { etag } = await this.assetStorageService.put(key, body, contentType);
    return Response.json({ ok: true, key, size: body.byteLength, etag });
  };
}

export default AssetRouteService;
