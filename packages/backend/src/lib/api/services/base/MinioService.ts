// The MinIO client and the assets bucket: the bucket is created on first
// use when it does not exist (a fresh MinIO), the same way tad-core-signing's
// BaseStorage ensures its buckets.
import { Client } from 'minio';
import { singleshot } from 'functools-kit';
import { CC_MINIO_ACCESSKEY, CC_MINIO_BUCKET, CC_MINIO_ENDPOINT, CC_MINIO_PORT, CC_MINIO_SECRETKEY, CC_MINIO_USE_SSL } from '../../../../config/params';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type LoggerService from './LoggerService';

export class MinioService {
  private readonly loggerService = inject<LoggerService>(TYPES.loggerService);

  public getClient = singleshot(
    (): Client =>
      new Client({
        endPoint: CC_MINIO_ENDPOINT,
        port: CC_MINIO_PORT,
        useSSL: CC_MINIO_USE_SSL,
        accessKey: CC_MINIO_ACCESSKEY,
        secretKey: CC_MINIO_SECRETKEY,
      }),
  );

  public get bucket(): string {
    return CC_MINIO_BUCKET;
  }

  /** The assets bucket exists (made when missing); throws (and forgets) when MinIO cannot be reached. */
  public waitForInit = singleshot(async (): Promise<void> => {
    try {
      const client = this.getClient();
      if (!(await client.bucketExists(CC_MINIO_BUCKET))) {
        await client.makeBucket(CC_MINIO_BUCKET);
        this.loggerService.log('minioService', 'bucket created', { bucket: CC_MINIO_BUCKET });
      }
      this.loggerService.log('minioService', 'ready', { endpoint: CC_MINIO_ENDPOINT, port: CC_MINIO_PORT, bucket: CC_MINIO_BUCKET });
    } catch (error) {
      this.waitForInit.clear();
      throw error;
    }
  });
}

export default MinioService;
