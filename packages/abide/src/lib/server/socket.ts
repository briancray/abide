// socket(...) — the named, typed pub/sub topic primitive (sockets.md S1-S2). A socket is an
// isomorphic `Socket<T>` = `AsyncIterable<T>`: subscribe by iterating (`for await (const m of
// sock)`), unsubscribe by breaking. `publish(msg)` is the server broadcast path. Client-mediated
// publishes go through the hub's `ingressPublish` (M6 transport, phase 2), which is surfaced on
// `__socket` for the transport to call.
//
// One socket per file in `src/server/sockets/<name>.ts`; the name comes from the filename. This
// core is single-process (S3.3) — tail buffer + fanout live in one server process.

import { SocketHub, DROP } from "./internal/socketHub.ts";

// A mediating handler may return the transformed value to publish, or `void`/`DROP` to suppress
// the client publish. `DROP` is the explicit drop signal; a bare `void`/`undefined` return drops
// too.
export interface SocketOptions<T> {
  tail?: number;
  ttl?: number;
  clientPublish?: boolean;
  schema?: unknown;
  clients?: unknown;
  handler?: (message: T) => T | void | typeof DROP | Promise<T | void | typeof DROP>;
  crossOrigin?: unknown;
}

// Internal handle carried on `__socket`: the resolved options plus the transport ingress path.
export interface SocketInternals<T> {
  options: SocketOptions<T>;
  ingressPublish(message: T): Promise<void>;
  tailSnapshot(): T[];
}

export interface Socket<T> extends AsyncIterable<T> {
  publish(message: T): void;
  readonly __socket: SocketInternals<T>;
}

export function socket<T>(options?: SocketOptions<T>): Socket<T> {
  const hub = new SocketHub<T>(options ?? {});
  return {
    publish(message: T): void {
      hub.publish(message);
    },
    [Symbol.asyncIterator](): AsyncIterator<T> {
      return hub.subscribe();
    },
    __socket: {
      options: hub.options,
      ingressPublish: (message: T): Promise<void> => hub.ingressPublish(message),
      tailSnapshot: (): T[] => hub.tailSnapshot(),
    },
  };
}
