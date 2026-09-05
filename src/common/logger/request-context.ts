import { AsyncLocalStorage } from 'async_hooks';

export interface RequestContextStore {
  requestId: string;
  userId?: string;
  role?: string;
  ip?: string;
  userAgent?: string;
  correlationId?: string;
  [key: string]: any;
}

export class RequestContext {
  private static readonly storage = new AsyncLocalStorage<RequestContextStore>();

  static run<T>(store: RequestContextStore, callback: () => T): T {
    return this.storage.run(store, callback);
  }

  static get(): RequestContextStore | undefined {
    return this.storage.getStore();
  }

  static getRequestId(): string | undefined {
    return this.storage.getStore()?.requestId;
  }

  static getUserId(): string | undefined {
    return this.storage.getStore()?.userId;
  }

  static getRole(): string | undefined {
    return this.storage.getStore()?.role;
  }

  static set(key: keyof RequestContextStore, value: any): void {
    const store = this.storage.getStore();
    if (store) {
      store[key] = value;
    }
  }
}
