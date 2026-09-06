import { EventEmitter } from 'events';
import { Logger } from '@nestjs/common';

const logger = new Logger('MockQueue');

/**
 * In-memory Mock Queue used when Redis is disabled (REDIS_ENABLED=false).
 * Satisfies BullMQ Queue dependency injection without opening any TCP sockets.
 */
export class MockQueue extends EventEmitter {
  public name: string;
  public opts: any;

  constructor(name: string, opts?: any) {
    super();
    this.name = name;
    this.opts = opts || {};
  }

  async add(name: string, data: any, opts?: any): Promise<any> {
    const jobId = `mock-${this.name}-${Date.now()}`;
    logger.warn(
      `[Queue: ${this.name}] Redis is disabled. Dropping job '${name}' (${jobId}).`,
    );
    return {
      id: jobId,
      name,
      data,
      opts,
      timestamp: Date.now(),
      returnvalue: null,
      progress: 0,
      attemptsMade: 0,
      getState: async () => 'completed',
    };
  }

  async getJob(_jobId: string): Promise<any> {
    return null;
  }

  async close(): Promise<void> {
    this.removeAllListeners();
  }

  async disconnect(): Promise<void> {
    this.removeAllListeners();
  }

  async pause(): Promise<void> {}
  async resume(): Promise<void> {}
  async isPaused(): Promise<boolean> {
    return true;
  }
}

/**
 * In-memory Mock Worker used when Redis is disabled (REDIS_ENABLED=false).
 * Satisfies BullMQ WorkerHost processing without connecting to Redis.
 */
export class MockWorker extends EventEmitter {
  public name: string;
  public processor?: any;
  public opts: any;

  constructor(name: string, processor?: any, opts?: any) {
    super();
    this.name = name;
    this.processor = processor;
    this.opts = opts || {};
  }

  async run(): Promise<void> {}
  async close(): Promise<void> {
    this.removeAllListeners();
  }
  async pause(): Promise<void> {}
  async resume(): Promise<void> {}
  isRunning(): boolean {
    return false;
  }
}
