// The MongoDB connection (mongoose): connected on first use, awaited by the
// first request (15 s, then the wait is cleared so the next request tries
// again). The journal (RoomRecordService) is the only user; a Mongo that is
// down must not stop the lobby, so the journal writes are fire-and-forget.
import mongoose from 'mongoose';
import { singleshot, sleep } from 'functools-kit';
import { CC_MONGO_CONNECTION_STRING } from '../../../../config/params';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type LoggerService from './LoggerService';

const CONNECTION_TIMEOUT_MS = 15_000;
const TIMEOUT = Symbol('timeout');

export class MongooseService {
  private readonly loggerService = inject<LoggerService>(TYPES.loggerService);

  private readonly connect = singleshot(async () => {
    mongoose.connection.on('error', (error) => this.loggerService.error('mongooseService', 'connection error', error));
    mongoose.connection.on('disconnected', () => this.loggerService.warn('mongooseService', 'disconnected'));
    await mongoose.connect(CC_MONGO_CONNECTION_STRING, { serverSelectionTimeoutMS: CONNECTION_TIMEOUT_MS });
  });

  public waitForInit = singleshot(async (): Promise<void> => {
    if (mongoose.connection.readyState === 1) return;
    const result = await Promise.race([this.connect(), sleep(CONNECTION_TIMEOUT_MS).then(() => TIMEOUT)]);
    if (result === TIMEOUT) {
      this.waitForInit.clear();
      this.connect.clear();
      throw new Error('MongoDB connection timeout');
    }
    this.loggerService.log('mongooseService', 'connected', { db: mongoose.connection.name });
  });

  public get ready(): boolean {
    return mongoose.connection.readyState === 1;
  }
}

export default MongooseService;
