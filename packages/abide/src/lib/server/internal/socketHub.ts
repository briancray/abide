// SocketHub — the single-process pub/sub core behind `socket(...)` (sockets.md S1-S2).
//
// A hub is one named topic's in-memory state: a bounded tail ring buffer for replay and a set
// of live subscribers, each backed by its own bounded FIFO queue. `publish` is the server path
// (bypasses the handler); `ingressPublish` is the transport path for client publishes — it runs
// the content-mediation handler (transform → publish, DROP/void → drop, throw → reject) before
// fanning out. Delivery is at-most-once, best-effort: on a subscriber queue overflow the oldest
// message is dropped for that subscriber (S3.4).

import type { SocketOptions } from "../socket.ts";

// A handler returning DROP (or nothing) suppresses the client publish. Exported so mediating
// handlers can signal an explicit drop without republishing.
export const DROP: unique symbol = Symbol("abide.socket.drop");

// Per-subscriber outbound bound (S3.4). Beyond this the oldest queued message is shed.
const DEFAULT_SUBSCRIBER_CAPACITY = 1024;

interface TailEntry<T> {
  message: T;
  time: number;
}

// One live consumer. Single-consumer by construction: exactly one iterator drains it, so a lone
// `waiting` resolver slot is sufficient.
class Subscriber<T> {
  private readonly queue: T[] = [];
  private readonly capacity: number;
  private waiting: ((result: IteratorResult<T>) => void) | null = null;
  private closed = false;

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  push(message: T): void {
    if (this.closed) return;
    if (this.waiting !== null) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve({ value: message, done: false });
      return;
    }
    this.queue.push(message);
    // Overflow: drop OLDEST for this subscriber (at-most-once, best-effort).
    if (this.queue.length > this.capacity) this.queue.shift();
  }

  next(): Promise<IteratorResult<T>> {
    if (this.queue.length > 0) {
      return Promise.resolve({ value: this.queue.shift() as T, done: false });
    }
    if (this.closed) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve) => {
      this.waiting = resolve;
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.waiting !== null) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve({ value: undefined, done: true });
    }
  }
}

export class SocketHub<T> {
  readonly options: SocketOptions<T>;
  private readonly tailSize: number;
  private readonly ttl: number;
  private readonly capacity: number;
  private readonly tail: TailEntry<T>[] = [];
  private readonly subscribers = new Set<Subscriber<T>>();

  constructor(options: SocketOptions<T>) {
    this.options = options;
    this.tailSize = options.tail ?? 0;
    this.ttl = options.ttl ?? Infinity;
    this.capacity = DEFAULT_SUBSCRIBER_CAPACITY;
  }

  // Server publish — append to the tail buffer and fan out. Never runs the handler (S1.3).
  publish(message: T): void {
    if (this.tailSize > 0) {
      this.tail.push({ message, time: Date.now() });
      while (this.tail.length > this.tailSize) this.tail.shift();
    }
    for (const subscriber of this.subscribers) subscriber.push(message);
  }

  // Transport path for CLIENT publishes (S1.3-B). Runs the mediating handler; a returned value
  // is published (transform), DROP/undefined suppresses, a throw rejects to the publisher.
  async ingressPublish(message: T): Promise<void> {
    const handler = this.options.handler;
    if (handler === undefined) {
      this.publish(message);
      return;
    }
    const result = await handler(message);
    if (result === undefined || (result as unknown) === DROP) return;
    this.publish(result as T);
  }

  // A one-shot snapshot of the in-window tail (last-N within ttl, S2) — the MCP tail tool's
  // request/response view (MS2.2). Ordered oldest→newest, same window a fresh subscriber replays.
  tailSnapshot(): T[] {
    const now = Date.now();
    const messages: T[] = [];
    for (const entry of this.tail) {
      if (now - entry.time <= this.ttl) messages.push(entry.message);
    }
    return messages;
  }

  // Subscribe = replay the in-window tail, then live messages, over a bounded FIFO iterator.
  // Snapshot + registration are synchronous, so no publish can interleave and break FIFO.
  subscribe(): AsyncIterator<T> {
    const subscriber = new Subscriber<T>(this.capacity);
    const now = Date.now();
    for (const entry of this.tail) {
      if (now - entry.time <= this.ttl) subscriber.push(entry.message);
    }
    this.subscribers.add(subscriber);

    const subscribers = this.subscribers;
    return {
      next: (): Promise<IteratorResult<T>> => subscriber.next(),
      return: (): Promise<IteratorResult<T>> => {
        subscribers.delete(subscriber);
        subscriber.close();
        return Promise.resolve({ value: undefined, done: true });
      },
    };
  }
}
