import type { AdaptiveSetLogResponse, SetLogInput } from "./contracts.js";

export interface QueuedSet {
  sessionId: string;
  input: SetLogInput;
  enqueuedAt: string;
  attempts: number;
  lastError?: string;
}

export interface QueueStorage {
  load(): Promise<QueuedSet[]>;
  save(items: QueuedSet[]): Promise<void>;
}

export class MemoryQueueStorage implements QueueStorage {
  constructor(private items: QueuedSet[] = []) {}

  async load(): Promise<QueuedSet[]> {
    return structuredClone(this.items);
  }

  async save(items: QueuedSet[]): Promise<void> {
    this.items = structuredClone(items);
  }
}

export class LocalStorageQueueStorage implements QueueStorage {
  constructor(
    private readonly storage: Storage,
    private readonly key = "myoadapt.offline-sets.v1"
  ) {}

  async load(): Promise<QueuedSet[]> {
    const raw = this.storage.getItem(this.key);
    if (!raw) return [];
    try {
      const value = JSON.parse(raw) as unknown;
      return Array.isArray(value) ? (value as QueuedSet[]) : [];
    } catch {
      return [];
    }
  }

  async save(items: QueuedSet[]): Promise<void> {
    this.storage.setItem(this.key, JSON.stringify(items));
  }
}

export interface FlushResult {
  synced: Array<{ queued: QueuedSet; response: AdaptiveSetLogResponse }>;
  pending: number;
  failed?: QueuedSet;
}

export class OfflineSetQueue {
  constructor(
    private readonly storage: QueueStorage,
    private readonly sender: (
      sessionId: string,
      input: SetLogInput
    ) => Promise<AdaptiveSetLogResponse>
  ) {}

  async enqueue(sessionId: string, input: SetLogInput): Promise<QueuedSet> {
    const items = await this.storage.load();
    const existing = items.find(
      (item) => item.sessionId === sessionId && item.input.clientSetId === input.clientSetId
    );
    if (existing) return existing;
    const queued = { sessionId, input, enqueuedAt: new Date().toISOString(), attempts: 0 };
    items.push(queued);
    await this.storage.save(items);
    return queued;
  }

  async pending(): Promise<QueuedSet[]> {
    return this.storage.load();
  }

  async flush(): Promise<FlushResult> {
    const items = await this.storage.load();
    const synced: FlushResult["synced"] = [];
    while (items.length > 0) {
      const queued = items[0]!;
      try {
        const response = await this.sender(queued.sessionId, queued.input);
        synced.push({ queued, response });
        items.shift();
        await this.storage.save(items);
      } catch (error) {
        queued.attempts += 1;
        queued.lastError = error instanceof Error ? error.message : String(error);
        await this.storage.save(items);
        return { synced, pending: items.length, failed: queued };
      }
    }
    return { synced, pending: 0 };
  }
}

export function stableClientSetId(
  sessionId: string,
  exerciseSlug: string,
  setIndex: number,
  performedAt: string
): string {
  return `${sessionId}:${exerciseSlug}:${setIndex}:${performedAt}`;
}
