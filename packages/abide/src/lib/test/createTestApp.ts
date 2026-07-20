// createTestApp — an in-process app harness for tests (M2 + M7 auth). Boots the real router on
// an ephemeral port and hands back a small surface: `fetch` against the live origin, an `rpc`
// proxy that calls registered routes with the right verb, a `health` probe, `stop`, and `as`
// for impersonating an identity.
//
// `as(identity)` does not start a second server — it returns a sibling TestApp bound to the
// same origin that stamps an `Authorization: Bearer <sealed identity>` header onto every
// request, exercising the real per-user-token rung of the identity ladder (AU9). The rpc proxy
// sends Content-Type: application/json on mutations so they satisfy the CSRF gate (AU8).

import { createApp, type App, type Route } from "../server/internal/router.ts";
import { seal } from "../server/internal/seal.ts";
import type { Middleware } from "../server/internal/middleware.ts";
import type { Principal } from "../server/internal/scope.ts";
import type { Socket } from "../server/socket.ts";

// A thin test client over the multiplexed socket WS (`/__abide/sockets`). `subscribe(name)`
// yields the framed messages for that socket; `publish(name, msg)` sends a client publish. Close
// it (or the app) to release the connection.
export interface SocketClient {
  ready(): Promise<void>;
  // `args` is sent alongside an `@rpc:` cache-channel subscribe (the raw args that must NAME the
  // channel — the args-spoof defense); it is ignored for bare user-socket subscriptions.
  subscribe<T = unknown>(name: string, args?: unknown): AsyncIterable<T>;
  publish(name: string, message: unknown): void;
  close(): void;
}

export interface TestApp {
  origin: string;
  fetch(path: string, init?: RequestInit): Promise<Response>;
  rpc: Record<string, (args?: unknown) => Promise<unknown>>;
  socket(name?: string): SocketClient;
  health(): Promise<Response>;
  stop(): Promise<void>;
  as(identity: Partial<Principal>): TestApp;
}

// NOTE (contract deviation): the fixed sketch typed `routes` as `Record<string, Rpc<any, any>>`,
// but the mutation verbs (POST/PUT/PATCH/DELETE) produce `Mutation`, which is not assignable to
// `Rpc`. Widened to `Route` (the `Rpc | Mutation` union) so both reads and mutations register.
export interface TestAppConfig {
  routes?: Record<string, Route>;
  middleware?: Middleware[];
  sockets?: Record<string, Socket<any>>;
  pages?: Record<string, string>;
  layouts?: Record<string, string>;
  // TODO #20: absolute source dirs (keyed like `pages`/`layouts`) so the client bundle can resolve a
  // page/layout's relative CSS imports. Normally populated by the file loader; exposed here for tests.
  pageDirs?: Record<string, string>;
  layoutDirs?: Record<string, string>;
}

// A minimal pushable async queue: producers `push`/`close`, one consumer iterates. Backs each
// live socket subscription on the test client.
class MessageQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiting: ((result: IteratorResult<T>) => void)[] = [];
  private closed = false;

  push(value: T): void {
    if (this.closed) return;
    const resolve = this.waiting.shift();
    if (resolve !== undefined) resolve({ value, done: false });
    else this.values.push(value);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const resolve of this.waiting) resolve({ value: undefined as never, done: true });
    this.waiting.length = 0;
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this.values.length > 0) return Promise.resolve({ value: this.values.shift() as T, done: false });
        if (this.closed) return Promise.resolve({ value: undefined as never, done: true });
        return new Promise((resolve) => this.waiting.push(resolve));
      },
    };
  }
}

function socketClient(origin: string, identity: Partial<Principal> | undefined): SocketClient {
  const queues = new Map<string, MessageQueue<unknown>[]>();
  let ws: WebSocket | undefined;

  // Seal the impersonated identity into a Bearer header BEFORE opening the WS so the upgrade
  // resolves it through the real per-user-token rung of the identity ladder (matching HTTP `as`).
  // Bun's WebSocket accepts a non-standard `headers` option; the DOM lib type omits it (cast).
  const opened = (async (): Promise<void> => {
    const url = origin.replace(/^http/, "ws") + "/__abide/sockets";
    if (identity !== undefined) {
      const token = await seal(identity as Principal);
      ws = new WebSocket(url, { headers: { authorization: `Bearer ${token}` } } as unknown as string[]);
    } else {
      ws = new WebSocket(url);
    }
    ws.addEventListener("message", (event) => {
      let frame: { name?: unknown; msg?: unknown };
      try {
        frame = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (typeof frame.name !== "string") return;
      const list = queues.get(frame.name);
      if (list === undefined) return;
      for (const queue of list) queue.push(frame.msg);
    });
    await new Promise<void>((resolve, reject) => {
      ws!.addEventListener("open", () => resolve());
      ws!.addEventListener("error", (event) => reject(event));
    });
  })();

  return {
    ready: (): Promise<void> => opened,
    subscribe<T = unknown>(name: string, args?: unknown): AsyncIterable<T> {
      const queue = new MessageQueue<T>();
      let list = queues.get(name) as MessageQueue<T>[] | undefined;
      if (list === undefined) {
        list = [];
        queues.set(name, list as MessageQueue<unknown>[]);
      }
      list.push(queue);
      const frame = args !== undefined ? { t: "sub", name, args } : { t: "sub", name };
      void opened.then(() => ws!.send(JSON.stringify(frame)));
      return queue;
    },
    publish(name: string, message: unknown): void {
      void opened.then(() => ws!.send(JSON.stringify({ t: "pub", name, msg: message })));
    },
    close(): void {
      for (const list of queues.values()) for (const queue of list) queue.close();
      queues.clear();
      // Swallow a rejected `opened` (e.g. a denied/failed upgrade) so close() never throws.
      void opened.then(() => ws?.close()).catch(() => {});
      ws?.close();
    },
  };
}

// Read the abide-identity `Set-Cookie` back off a response as a `name=value` pair ready to send
// as a `Cookie` header, so tests can assert the login cookie and replay it on a follow-up.
export function identityCookie(response: Response): string | undefined {
  for (const cookie of response.headers.getSetCookie()) {
    if (cookie.startsWith("abide-identity=")) return cookie.split(";")[0];
  }
  return undefined;
}

function bind(app: App, routes: Record<string, Route>, identity: Partial<Principal> | undefined): TestApp {
  const origin = app.origin;

  async function decorate(init?: RequestInit): Promise<RequestInit> {
    const headers = new Headers(init?.headers);
    if (identity !== undefined) {
      const token = await seal(identity as Principal);
      headers.set("authorization", `Bearer ${token}`);
    }
    return { ...init, headers };
  }

  async function doFetch(path: string, init?: RequestInit): Promise<Response> {
    return fetch(origin + path, await decorate(init));
  }

  const rpc = new Proxy({} as Record<string, (args?: unknown) => Promise<unknown>>, {
    get(_target, property: string) {
      return async (args?: unknown): Promise<unknown> => {
        const route = routes[property];
        const read = route?.__rpc.read ?? false;
        let response: Response;
        if (read) {
          const query = args !== undefined ? `?args=${encodeURIComponent(JSON.stringify(args))}` : "";
          response = await doFetch(`/rpc/${property}${query}`, { method: "GET" });
        } else if (args instanceof FormData) {
          // TODO #8 multipart upload: send the FormData as the raw body (fetch sets the boundary)
          // with the `x-abide` header so the CSRF gate admits it — no content-type header.
          response = await doFetch(`/rpc/${property}`, {
            method: "POST",
            headers: { "x-abide": "1" },
            body: args,
          });
        } else {
          response = await doFetch(`/rpc/${property}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(args ?? {}),
          });
        }
        return response.json();
      };
    },
  });

  return {
    origin,
    fetch: doFetch,
    rpc,
    socket: (_name?: string): SocketClient => socketClient(origin, identity),
    health: (): Promise<Response> => doFetch("/__abide/health"),
    stop: (): Promise<void> => app.stop(),
    as: (asIdentity: Partial<Principal>): TestApp => bind(app, routes, asIdentity),
  };
}

export function createTestApp(config: TestAppConfig = {}): TestApp {
  const app = createApp(config);
  return bind(app, config.routes ?? {}, undefined);
}
