import { Queue, Worker } from 'bullmq';
import { Logger, ServiceUnavailableException } from '@nestjs/common';

const logger = new Logger('ResilientQueue');

/**
 * Resilient BullMQ Queue that prevents unhandled EventEmitter errors from
 * crashing the Node.js process, throttles repetitive connection error logs,
 * and converts enqueue failures into controlled ServiceUnavailableException (503) errors.
 */
export class ResilientQueue extends Queue {
  private lastEmittedError = 0;

  constructor(name: string, opts?: any) {
    super(name, opts);

    // Prevent unhandled 'error' events from crashing the process
    this.on('error', (err: any) => {
      // Handled via emit override; catch here ensures an active listener always exists
    });
  }

  override emit(event: string | symbol, ...args: any[]): boolean {
    if (event === 'error') {
      const err = args[0];
      const errMsg = err?.message || String(err);
      if (
        errMsg.includes('ECONNREFUSED') ||
        errMsg.includes('ENOTFOUND') ||
        errMsg.includes('ETIMEDOUT') ||
        errMsg.includes('closed')
      ) {
        const now = Date.now();
        if (now - this.lastEmittedError < 30000) {
          return false;
        }
        this.lastEmittedError = now;
        logger.warn(
          `[Queue: ${this.name}] Connection degraded (${errMsg}). Queues operating in degraded mode.`,
        );
      }
    }
    return super.emit(event as any, ...args);
  }

  async add(name: string, data: any, opts?: any): Promise<any> {
    try {
      return await super.add(name, data, opts);
    } catch (err: any) {
      logger.error(
        `[Queue: ${this.name}] Failed to enqueue job '${name}': ${err.message || err}`,
      );
      throw new ServiceUnavailableException(
        `Queue service is temporarily unavailable. Job '${name}' could not be processed.`,
      );
    }
  }

  async close(): Promise<void> {
    try {
      await super.close();
    } catch {
      // Ignore shutdown errors on disconnected queues
    }
  }

  async disconnect(): Promise<void> {
    try {
      if (typeof (this as any).disconnect === 'function') {
        await (this as any).disconnect();
      }
    } catch {
      // Ignore disconnect errors
    }
  }
}

/**
 * Resilient BullMQ Worker that catches connection and operational errors,
 * throttles repetitive reconnect logs, and prevents worker errors from crashing the application.
 */
export class ResilientWorker extends Worker {
  private lastEmittedError = 0;

  constructor(name: string, processor?: any, opts?: any) {
    super(name, processor, opts);

    // Prevent unhandled worker 'error' events from terminating the process
    this.on('error', (err: any) => {
      // Handled via emit override; catch here ensures an active listener always exists
    });
  }

  override emit(event: string | symbol, ...args: any[]): boolean {
    if (event === 'error') {
      const err = args[0];
      const errMsg = err?.message || String(err);
      if (
        errMsg.includes('ECONNREFUSED') ||
        errMsg.includes('ENOTFOUND') ||
        errMsg.includes('ETIMEDOUT') ||
        errMsg.includes('closed')
      ) {
        const now = Date.now();
        if (now - this.lastEmittedError < 30000) {
          return false;
        }
        this.lastEmittedError = now;
      }
    }
    return super.emit(event as any, ...args);
  }

  async close(): Promise<void> {
    try {
      await super.close();
    } catch {
      // Ignore shutdown errors
    }
  }
}
