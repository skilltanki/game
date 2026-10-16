// The game assets in the MinIO bucket: a HEAD-like stat (size, md5 etag,
// content type), the object's stream, and a put for the seeding script and
// the dev upload route. Keys are the paths under /assets/ (`maps/...`,
// `tanks/...`), the same tree `npm run upload-assets` ships.
import type { Readable } from 'node:stream';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type MinioService from '../base/MinioService';

export interface AssetStat {
  size: number;
  /** The object's md5 as MinIO reports it (quoted: an HTTP ETag). */
  etag: string;
  contentType: string | null;
  lastModified: Date;
}

export class AssetStorageService {
  private readonly minioService = inject<MinioService>(TYPES.minioService);

  public stat = async (key: string): Promise<AssetStat | null> => {
    try {
      const stat = await this.minioService.getClient().statObject(this.minioService.bucket, key);
      const etag = stat.etag.startsWith('"') ? stat.etag : `"${stat.etag}"`;
      const contentType = (stat.metaData?.['content-type'] as string | undefined) ?? null;
      return { size: stat.size, etag, contentType, lastModified: stat.lastModified };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  };

  public get = async (key: string): Promise<Readable> => this.minioService.getClient().getObject(this.minioService.bucket, key);

  public put = async (key: string, body: Buffer, contentType: string): Promise<{ etag: string }> => {
    const result = await this.minioService.getClient().putObject(this.minioService.bucket, key, body, body.byteLength, { 'Content-Type': contentType });
    return { etag: result.etag };
  };
}

function isNotFound(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === 'NotFound' || code === 'NoSuchKey';
}

export default AssetStorageService;
