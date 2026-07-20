// The abide RPC FACTORY — shared construction for the HTTP verb helpers (M2).
//
// A verb helper turns a plain handler `fn(args)` into an `Rpc`: an isomorphic callable the
// router mounts (via `__rpc` metadata) and that server/client code invokes directly.
//
// READS (GET/HEAD) wrap the handler in a `cell` so in-process calls cache, coalesce, and are
// reactive — `(args)` reactively peeks, `load/peek/pending/error/refresh/invalidate` mirror
// the cell surface. cache.ttl flows into the cell; the remaining options (schemas/clients/
// crossOrigin/maxBodySize/timeout/middleware) are carried untouched for the router to enforce.
// `cache: false` on a read means "don't retain" → the cell runs at ttl:0 (coalesce concurrent, never
// serve stale) while keeping the reactive surface.
//
// MUTATIONS (POST/PUT/PATCH/DELETE) now ALSO route through a cell, but default to `cache: { ttl: 0 }`
// (replayable-streams.md §1): coalesce identical CONCURRENT in-flight calls, retain nothing after
// settle. A non-shared mutation's slot is per-request, so this is inert for the normal one-call-per-
// request case and preserves at-least-once across separate requests; cross-request dedup needs
// `shared: true`. `cache: false` opts OUT entirely (direct call, no cell) — for a non-idempotent
// handler where every call must run. A `FormData` body ALWAYS bypasses the cell (it can't be safely
// keyed — see §1). The public Mutation surface stays call-only + `__rpc` (no peek/amend): the cell is
// an internal coalescing mechanism, incoherent to expose as reactive probes on a non-retained slot.

import { cell, type CellOptions, type CacheNotify } from "../../shared/cell.ts";
import type { Payload } from "../../shared/internal/responseSource.ts";
export type { Payload } from "../../shared/internal/responseSource.ts";
import type { Middleware } from "./middleware.ts";
import type { StandardSchemaV1 } from "../../shared/StandardSchema.ts";
import type { JSONSchema } from "../../shared/internal/jsonSchema.ts";

// A minimal, JSON-Schema-ish description of the file fields a multipart mutation accepts (TODO #8).
// `required` names the file fields that MUST be present as a `File`; `properties` optionally
// constrains a field's byte size (`maxSize`) and/or MIME type (`accept`, exact or `image/*`
// wildcard). Text fields ride in the same FormData but are described by the JSON `input` schema, not
// here — the router projects the multipart non-File fields and validates them against `input` (TODO
// #8 follow-up), while a `File` never rides in the JSON args object (decision TODO #8).
export interface FilesSchema {
  required?: string[];
  properties?: Record<string, { maxSize?: number; accept?: string | string[] }>;
}

// M8b: input/output accept EITHER a Standard Schema (Zod/Valibot/etc.) OR a raw/derived JSON Schema;
// the router normalises whichever it gets via `asStandardSchema` before validating. `files`
// describes the multipart file fields (TODO #8) — validated by `validateFiles` on a multipart
// request; the JSON `input` schema governs the non-multipart JSON args path AND the multipart TEXT
// fields (projected via `projectFormText`, TODO #8 follow-up).
export interface RpcSchemas {
  input?: StandardSchemaV1 | JSONSchema;
  output?: StandardSchemaV1 | JSONSchema;
  files?: FilesSchema;
}

export interface RpcOptions {
  schemas?: RpcSchemas;
  clients?: unknown;
  // Optional human/machine description for the RPC, surfaced into the registry and every machine
  // surface (OpenAPI operation summary, MCP tool description, CLI --help). Schema-level
  // description/title still wins per MS1.2; this fills the gap when the schema carries none.
  doc?: string;
  middleware?: Middleware[];
  crossOrigin?: unknown;
  maxBodySize?: number;
  timeout?: number;
  // `false` opts a call OUT of the cell entirely (replayable-streams.md §1): a mutation runs every call
  // (no coalescing); a read runs at ttl:0. `{ … }` overrides the per-verb default (reads ttl:∞,
  // mutations ttl:0).
  cache?: false | { ttl?: number; shared?: boolean; tags?: string[] };
}

// Router-facing metadata baked onto every Rpc/Mutation. `read` distinguishes cache-backed
// reads from direct-call mutations; `handler` is the untouched user function (schema
// validation and client gating wrap it later, at mount time).
export interface RpcMeta<Args, T> {
  method: string;
  handler: (args: Args) => Promise<T> | T;
  options: RpcOptions;
  read: boolean;
}

// A read-call argument tuple. A ZERO-arg handler (`GET(() => …)`) infers `Args = unknown`, so the
// argument is OPTIONAL — a bare `fn()` / `fn.pending()` type-checks (the documented zero-arg read). A
// handler with a declared args type (`GET((a: { id: string }) => …)`) keeps `Args` concrete, so the
// argument stays REQUIRED. `unknown extends Args` is true only for `unknown`/`any`, false for any
// concrete shape — exactly the discriminator between "no declared input" and "declared input".
export type RpcCallArgs<Args> = unknown extends Args ? [args?: Args] : [args: Args];

export interface Rpc<Args, T> {
  // THE READ (Promise-read model): the bare call is the awaitable, coalesced load; it also subscribes
  // the calling reactive context, so `{await fn()}` / `{#await fn()}` re-await on invalidate. Use
  // `.peek()` for the non-blocking `T | undefined` snapshot.
  (...args: RpcCallArgs<Args>): Promise<T>;
  // Reactive peek: subscribes, kicks a coalesced load when cold, returns value or undefined.
  peek(...args: RpcCallArgs<Args>): T | undefined;
  // @deprecated Use the bare call — `fn(args)` IS the load now. Retained as a migration alias.
  load(...args: RpcCallArgs<Args>): Promise<T>;
  pending(...args: RpcCallArgs<Args>): boolean;
  // Revalidating over a retained value (distinct from first-load `pending`). Reactive.
  refreshing(...args: RpcCallArgs<Args>): boolean;
  error(...args: RpcCallArgs<Args>): unknown;
  // Run `handler` whenever this slot's value changes; returns a dispose function. Reactive probe.
  watch(args: Args, handler: (value: T | undefined) => void): () => void;
  // Raw `Response`, full bypass of the cell (rpc-core call surface): on the client a bare fetch to
  // `/rpc/<name>`; on the server the handler run wrapped in a JSON `Response` (or its own Response).
  raw(args: Args, init?: RequestInit): Promise<Response>;
  // Narrow a caught value to this RPC's typed error by name (`fn.isError(e, "RateLimited")`).
  isError(e: unknown, name: string): boolean;
  // Partial selector matches every superset slot (spec: partial-object match); mirrors `Cell`.
  refresh(args?: Partial<Args> | Args): void;
  invalidate(args?: Partial<Args> | Args): void;
  // Mutate the retained value in place (value-form or updater-form); mirrors `Cell`. On a `shared`
  // read this broadcasts (value-form directly, updater-form resolves server-side then broadcasts).
  amend(args: Args, next: T | ((current: T | undefined) => T)): void;
  // §5 hydration: `snapshot()` records this read's resolved slots for the seed; `seed()` replays a
  // recorded (args, value) into the cache so the client resolves from cache instead of re-fetching.
  snapshot(): Array<{ args: Args; value: T }>;
  seed(args: Args, value: T): void;
  // SERVER-ONLY broadcast seam (rpc-core §8, PR2). `createApp` calls this on a `shared` read to bind
  // the cell's transport-free `notify` sink to a channel publish. Transport stays out of makeRpc —
  // the sink is supplied by createApp (which alone knows the route NAME). A no-op until bound.
  bindBroadcast(sink: CacheNotify): void;
  readonly __rpc: RpcMeta<Args, T>;
}

// A STREAMING read — a handler that yields an `AsyncIterable<C>` (replayable-streams.md §4). The read
// resolves to a fresh replay-then-live `consume()` cursor, and the surface is stream-correct: reactive
// chunk probes (`latest`/`chunks`/`done`) instead of the value-shaped `peek`/`amend`/`snapshot`, which
// are meaningless (or throw) on a stream slot. This is what a user's editor sees for a streaming read.
export interface StreamRead<Args, C> {
  // THE READ: awaitable; resolves to a fresh cursor that replays the transcript so far then goes live.
  (...args: RpcCallArgs<Args>): Promise<AsyncIterable<C>>;
  // Reactive PEEK: the "current value" of a stream = its MOST-RECENT chunk (undefined before the first).
  // The non-blocking "latest value" read — same name/role as a value read's `peek`. Use `chunks` for all.
  peek(...args: RpcCallArgs<Args>): C | undefined;
  // Reactive snapshot (copy) of the whole transcript so far; undefined until the stream starts.
  chunks(...args: RpcCallArgs<Args>): C[] | undefined;
  // Source started but no chunk yet. Reactive.
  pending(...args: RpcCallArgs<Args>): boolean;
  // The stream has closed (settled successfully). Reactive.
  done(...args: RpcCallArgs<Args>): boolean;
  // Terminal error (read off the stream) or undefined. Reactive.
  error(...args: RpcCallArgs<Args>): unknown;
  // Re-run the source; `invalidate` aborts an open stream + drops it (replayable-streams.md §4).
  refresh(args?: Partial<Args> | Args): void;
  invalidate(args?: Partial<Args> | Args): void;
  // Raw `Response`, full bypass (single-consumption stream body; no replay).
  raw(args: Args, init?: RequestInit): Promise<Response>;
  isError(e: unknown, name: string): boolean;
  readonly __rpc: RpcMeta<Args, AsyncIterable<C>>;
}

// The surface a read helper (GET/HEAD) yields. A handler may return its result RAW or wrapped in a
// transport helper; both resolve to the same thing (replayable-streams.md §4), so we unwrap the brand
// first via `Payload<R>`, then choose StreamRead (iterable) vs Rpc (value). The `[…]` tuple wraps make
// the conditionals non-distributive over a union return type.
export type ReadSurface<Args, R> = [Payload<R>] extends [AsyncIterable<infer C>] ? StreamRead<Args, C> : Rpc<Args, Payload<R>>;

export interface Mutation<Args, T> {
  // Direct call: runs the handler every time, no cache; resolves with its return value. A mutation
  // also accepts a `FormData` (TODO #8 multipart upload) — the handler receives it as its single
  // positional argument; a `File` rides in the FormData body, never in the JSON `Args` object.
  (args: Args | FormData): Promise<T>;
  readonly __rpc: RpcMeta<Args, T>;
}

function attachMeta<Args, T>(target: object, meta: RpcMeta<Args, T>): void {
  Object.defineProperty(target, "__rpc", { value: meta, enumerable: false });
}

// Narrow a caught value to a typed error by name — used by `fn.isError(e, name)`. A typed error
// (`error.typed(name, …)`) carries its name as `kind` (client HttpError-like) or `name` (server
// HttpError). Isomorphic: the same predicate works for a server-thrown error and a client-fetched one.
export function isTypedError(e: unknown, name: string): boolean {
  if (e === null || typeof e !== "object") return false;
  const record = e as Record<string, unknown>;
  return record.kind === name || record.name === name;
}

export function makeRead<Args, T>(method: string, fn: (args: Args) => Promise<T> | T, opts?: RpcOptions): Rpc<Args, T> {
  const options = opts ?? {};

  // Only forward set fields — exactOptionalPropertyTypes forbids an explicit undefined.
  const cellOptions: CellOptions = {};
  // `cache: false` on a read = don't retain → ttl:0 (coalesce-only, always revalidate), keeping the
  // reactive cell surface (a full cell bypass is a mutation-only opt-out, since reads need the surface).
  if (options.cache === false) {
    cellOptions.ttl = 0;
  } else {
    const cacheConfig = options.cache;
    if (cacheConfig?.ttl !== undefined) cellOptions.ttl = cacheConfig.ttl;
    // `shared` opts this read into the process-global cross-request cache (rpc-core §2). Server-only
    // and fail-closed inside the cell: the handler runs scope-exited and reads require a live scope.
    if (cacheConfig?.shared === true) cellOptions.shared = true;
    // Tags register a shared read for the global `invalidate/refresh({ tags })` selectors (rpc-core
    // §8). Honored only on a shared cell (the tag registry is server-only); inert otherwise.
    if (cacheConfig?.tags !== undefined) cellOptions.tags = cacheConfig.tags;
  }
  // Late-bound broadcast target: the cell gets a stable, transport-free sink now; `createApp` sets
  // the actual publish target via `bindBroadcast` once the route name is known. Unbound → no-op.
  let broadcast: CacheNotify | undefined;
  cellOptions.notify = (verb, args, value): void => {
    if (broadcast !== undefined) broadcast(verb, args, value);
  };
  const backing = cell<Args, T>(fn, cellOptions);

  const rpc = ((args: Args): Promise<T> => backing(args)) as Rpc<Args, T>;
  rpc.peek = (args: Args): T | undefined => backing.peek(args);
  rpc.load = (args: Args): Promise<T> => backing.load(args);
  rpc.pending = (args: Args): boolean => backing.pending(args);
  rpc.refreshing = (args: Args): boolean => backing.refreshing(args);
  rpc.error = (args: Args): unknown => backing.error(args);
  rpc.watch = (args: Args, handler: (value: T | undefined) => void): (() => void) => backing.watch(args, handler);
  rpc.raw = async (args: Args, init?: RequestInit): Promise<Response> => {
    const value = await Promise.resolve(fn(args));
    if (value instanceof Response) return value;
    return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" }, ...(init ?? {}) });
  };
  rpc.isError = (e: unknown, name: string): boolean => isTypedError(e, name);
  rpc.refresh = (args?: Partial<Args> | Args): void => backing.refresh(args);
  rpc.invalidate = (args?: Partial<Args> | Args): void => backing.invalidate(args);
  rpc.amend = (args: Args, next: T | ((current: T | undefined) => T)): void => backing.amend(args, next);
  rpc.snapshot = (): Array<{ args: Args; value: T }> => backing.snapshot();
  rpc.seed = (args: Args, value: T): void => backing.seed(args, value);
  rpc.bindBroadcast = (sink: CacheNotify): void => {
    broadcast = sink;
  };
  // Stream probes live on the runtime object for ALL reads (they return undefined/false for a value
  // slot); only the StreamRead type surfaces them. `peek` is already stream-aware via the cell. Kept
  // off the value-shaped `Rpc` type.
  const streamable = rpc as Rpc<Args, T> & {
    chunks(args: Args): unknown[] | undefined;
    done(args: Args): boolean;
    resumeStream(args: Args, from: number): { cursor: AsyncIterable<unknown> | undefined; fresh: boolean };
  };
  streamable.chunks = (args: Args): unknown[] | undefined => backing.chunks(args);
  streamable.done = (args: Args): boolean => backing.done(args);
  streamable.resumeStream = (args: Args, from: number) => backing.resumeStream(args, from);
  attachMeta(rpc, { method, handler: fn, options, read: true });
  return rpc;
}

export function makeMutation<Args, R>(method: string, fn: (args: Args) => Promise<R> | R, opts?: RpcOptions): Mutation<Args, Payload<R>> {
  const options = opts ?? {};
  type T = Payload<R>;

  // `cache: false` → never route through the cell: every call runs the handler directly (the pre-cell
  // at-least-once behavior), for a genuinely non-idempotent mutation.
  // `fn` returns the (possibly transport-wrapped) `R`; the cell sees through it to the payload `T`.
  const handler = fn as unknown as (args: Args) => Promise<T> | T;
  if (options.cache === false) {
    const direct = ((args: Args | FormData) => Promise.resolve(handler(args as Args))) as Mutation<Args, T>;
    attachMeta(direct, { method, handler: fn, options, read: false });
    return direct;
  }

  // Otherwise route through a cell, defaulting to ttl:0 (coalesce concurrent-identical, retain nothing).
  const cacheConfig = options.cache;
  const cellOptions: CellOptions = { ttl: cacheConfig?.ttl ?? 0 };
  if (cacheConfig?.shared === true) cellOptions.shared = true;
  if (cacheConfig?.tags !== undefined) cellOptions.tags = cacheConfig.tags;
  const backing = cell<Args, T>(handler, cellOptions);

  const mutation = ((args: Args | FormData): Promise<T> => {
    // A FormData/multipart body can't be safely keyed (files have no cheap canonical value; a raw
    // FormData throws in canonicalKey) → always bypass the cell (replayable-streams.md §1).
    if (args instanceof FormData) return Promise.resolve(handler(args as Args));
    return backing(args);
  }) as Mutation<Args, T>;
  attachMeta(mutation, { method, handler: fn, options, read: false });
  return mutation;
}
