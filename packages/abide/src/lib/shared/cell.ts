// The abide CELL primitive — a generic isomorphic async memoizer (rpc-core §1-3, §7.2, §8).
//
// `cell(fn)` wraps any async function into a smart-read callable: per-context caching,
// in-flight coalescing, and a reactive read surface (peek/pending/error/refreshing/watch/
// refresh/invalidate/amend). RPC/socket helpers bake this behavior in; users reach for
// `cell()` to wrap their OWN third-party async functions and get identical ergonomics.
//
// Each cache slot `(cellId, canonicalKey(args))` IS a signal (§7.2): reading it in a
// tracking context subscribes; resolve/invalidate/amend re-run subscribers. The slot is a
// state machine idle -> pending -> value | error, with a `refreshing` flag while
// revalidating over a retained value. pending/error/refreshing/peek are derived views of
// the one slot, not separate channels.
//
// The opt-in server SHARED cross-request cache (`cache: { shared: true }`, rpc-core §2) is wired
// here: a shared cell stores its slots in the process-global `sharedStore()` and runs its handler
// fail-closed (scope-exited + ambient-guarded), server-only. A shared cell's verbs also fire an
// injectable, TRANSPORT-FREE `notify` sink (rpc-core §8 broadcast, PR2): the cell just calls it —
// `createApp` binds it to the actual channel publish (the cell never imports transport). A shared
// cell declaring `tags` (PR4) registers itself in the server tag registry so the global
// `invalidate/refresh({ tags })` selectors can drop/revalidate + broadcast its slots. TODO (later
// PRs): the client-side channel join/apply.

import { canonicalKey } from "./internal/codec.ts";
import { getContext, serverDefaultCache } from "./internal/context.ts";
import { sharedStore, sharedCacheTouch, sharedCacheRecordSize, sharedCacheEvictIfNeeded, sharedCachePin, sharedCacheUnpin } from "./internal/sharedCache.ts";
import { currentScope, runOutsideScope } from "../server/internal/scope.ts";
import { registerTaggedCell } from "../server/internal/cacheTags.ts";
import { effect, signal, untrack, type Signal } from "./internal/reactive.ts";
import { markSettled } from "./internal/settledRead.ts";
import { ReplayableStream } from "./internal/replayableStream.ts";
import { responseSourceOf, tagStreamEncoding } from "./internal/responseSource.ts";

// Side detection mirrors shared/internal/context.ts: `shared` is a SERVER concept (cross-request
// store + scope isolation). On the client a shared-flagged cell behaves like a normal client cell,
// so every shared-only branch below is gated on `!isBrowser`.
const isBrowser = typeof globalThis !== "undefined" && typeof (globalThis as { window?: unknown }).window !== "undefined";

// "stream" is the streaming-read slot (replayable-streams.md §4): the resolved value is not a scalar
// but a ReplayableStream the read fans out via `consume()`. Scalar (`value`) and stream slots stay
// monomorphic in their own field — a stream slot's `value` is always undefined and vice versa.
type Status = "idle" | "pending" | "value" | "error" | "stream";

// One immutable snapshot of a slot's state. Held inside the slot signal; every transition
// replaces it with a fresh object so the signal's `===` comparison always fires.
interface SlotState<T> {
  status: Status;
  value: T | undefined;
  error: unknown;
  refreshing: boolean;
  // Set only when status === "stream": the shared replay buffer this slot fans out (§4).
  stream?: ReplayableStream<unknown>;
}

interface Slot<Args, T> {
  args: Args;
  // The full cache-map key (`prefix + canonicalKey(args)`), retained for LRU touch/size accounting.
  key: string;
  signal: Signal<SlotState<T>>;
  // The single in-flight load promise for this slot; the coalescing point.
  inflight: Promise<T> | null;
  // When the current value/error settled (ms epoch), for TTL expiry. 0 while idle.
  loadedAt: number;
  // Bumped on invalidate/refresh so a superseded in-flight load discards its late result.
  generation: number;
  // Reactive chunk-progress tick for a STREAM slot (set on first stream start). Bumped on every chunk
  // push and on the terminal, so `latest`/`chunks`/`done` re-run as the transcript grows — kept SEPARATE
  // from `signal` so per-chunk updates never re-run the bare read (which would restart a `{#for await}`).
  streamTick?: Signal<number>;
}

// SERVER-ONLY broadcast sink (rpc-core §8, PR2). A shared cell calls this when a verb changes a
// slot: `invalidate`/`refresh` pass `(verb, args)`; value-form `amend` passes `(verb, args, value)`.
// The sink is transport-free from the cell's view — `createApp` binds it to a channel publish. `args`
// is the selector as given to the verb (partial or full), typed loosely since it may be a subset.
export type CacheNotify = (verb: "invalidate" | "refresh" | "amend", args: unknown, value?: unknown) => void;

export interface CellOptions {
  // Retained-value TTL in ms. Default Infinity (SWR-style: retained until invalidate/refresh).
  ttl?: number;
  // Explicit, stable cell id. Auto-generated per instance when omitted.
  key?: string;
  // Opt-in server cross-request cache (rpc-core §2). Server-only; INERT on the client (a
  // shared-flagged client cell behaves like a normal client cell). Slots live in the process-global
  // `sharedStore()` keyed only by args — safe ONLY for functions pure over their args. Enforced
  // fail-closed: the handler runs outside the request scope and a read requires an active scope.
  shared?: boolean;
  // SERVER-ONLY broadcast sink (rpc-core §8, PR2). Only invoked on a `shared` cell — a non-shared
  // cell never broadcasts even if a sink is present. Injected transport-free; `createApp` binds it.
  notify?: CacheNotify;
  // Cache tags (rpc-core §8, PR4). Server-only and honored ONLY on a `shared` cell: the cell
  // registers under each tag so the global `invalidate/refresh({ tags })` selectors can drop/
  // revalidate + broadcast its slots. Inert on the client and on a non-shared cell.
  tags?: string[];
}

export interface Cell<Args, T> {
  // THE READ (Promise-read model): the bare call is the awaitable, coalesced load. It ALSO subscribes
  // the calling reactive context to the slot, so a reactive `{await cell()}` re-runs and re-awaits when
  // the slot invalidates. Resolves with the value or rejects with the error.
  (args: Args): Promise<T>;
  // Reactive PEEK: the non-blocking snapshot. Subscribes to the slot and kicks a coalesced load when
  // cold, returning the current value or undefined while pending (this was the old bare call).
  peek(args: Args): T | undefined;
  // @deprecated Use the bare call — `cell(args)` IS the load now. Retained as a non-subscribing alias
  // during migration (identical to the bare call minus the reactive subscription).
  load(args: Args): Promise<T>;
  // No value yet (first load in flight). Reactive.
  pending(args: Args): boolean;
  // Retained error or undefined (a stream slot's error is read off the ReplayableStream). Reactive.
  error(args: Args): unknown;
  // STREAM probes (replayable-streams.md §4). Reactive; undefined/false for a non-stream slot. `peek()`
  // above returns the most-recent chunk for a stream; `chunks` = a copy of the transcript so far,
  // `done` = the stream has closed.
  chunks(args: Args): unknown[] | undefined;
  done(args: Args): boolean;
  // Resume a RETAINED stream transcript from chunk index `from` (replay `chunks[from..]` then live) —
  // the server side of the SSR→client attach (replayable-streams.md §5). `fresh: true` (with no cursor)
  // means no retained transcript exists, so the caller must run fresh from 0 and REPLACE, not append.
  resumeStream(args: Args, from: number): { cursor: AsyncIterable<unknown> | undefined; fresh: boolean };
  // Revalidating over a retained value. Reactive.
  refreshing(args: Args): boolean;
  // Re-run the load, keep the stale value visible (refreshing=true) until it resolves.
  refresh(args?: Partial<Args> | Args): void;
  // Drop matching slot(s) back to idle; lazy reload on next read.
  invalidate(args?: Partial<Args> | Args): void;
  // Mutate the retained value in place: value-form or updater-form.
  amend(args: Args, next: T | ((current: T | undefined) => T)): void;
  // Run handler on slot change; returns a dispose function.
  watch(args: Args, handler: (value: T | undefined) => void): () => void;
  // Every resolved slot in the active context — the SSR record source for the hydration seed
  // (rpc-core §5). Only `value`-state slots are reported; pending/error/idle are skipped.
  snapshot(): Array<{ args: Args; value: T }>;
  // Replay a recorded (args, value) into the cache as a settled `value` slot, so a matching read
  // resolves from cache instead of re-loading — the client half of §5 hydration seeding.
  seed(args: Args, value: T): void;
}

let cellCounter = 0;

function idleState<T>(): SlotState<T> {
  return { status: "idle", value: undefined, error: undefined, refreshing: false };
}

// Per-stream transcript cap in bytes (replayable-streams.md §4). Read fresh each call. Default =
// Infinity (UNBOUNDED) — mirroring ABIDE_MAX_SHARED_CACHE_SIZE's consciously-accepted memory tradeoff;
// the env var is the operator mitigation. When set, a stream exceeding it OVERFLOWs (bounded memory,
// no post-close replay) rather than growing unbounded.
function streamBufferCap(): number {
  const raw = Bun.env.ABIDE_MAX_STREAM_BUFFER_SIZE;
  if (raw === undefined || raw === "") return Infinity;
  const bytes = Number(raw);
  return Number.isFinite(bytes) && bytes > 0 ? bytes : Infinity;
}

// Byte measure for LRU accounting: the settled value's JSON length. Unrepresentable values
// (circular / functions) fall back to 0 rather than throwing on a happy-path settle.
function measureBytes(value: unknown): number {
  try {
    const json = JSON.stringify(value);
    return typeof json === "string" ? json.length : 0;
  } catch {
    return 0;
  }
}

// A streaming handler yields a raw AsyncIterable<chunk> (replayable-streams.md §4) — that is what the
// cell wraps in a ReplayableStream. A `Response` / `ReadableStream` is an opaque byte body (jsonl/sse or
// a raw fetch), NOT a decoded-chunk source, so it stays a scalar value and the existing pass-through
// behavior is untouched.
function isStreamSource(value: unknown): value is AsyncIterable<unknown> {
  if (value === null || typeof value !== "object") return false;
  if (value instanceof Response || value instanceof ReadableStream) return false;
  return typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === "function";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// Superset match (§8.2): a selector object matches a slot whose args include every selector
// key with a canonically-equal value. Non-object selectors fall back to exact key equality.
function matchesSelector(slotArgs: unknown, selector: unknown): boolean {
  if (isPlainObject(selector) && isPlainObject(slotArgs)) {
    for (const key of Object.keys(selector)) {
      if (!(key in slotArgs)) return false;
      if (canonicalKey(slotArgs[key]) !== canonicalKey(selector[key])) return false;
    }
    return true;
  }
  return canonicalKey(slotArgs) === canonicalKey(selector);
}

export function cell<Args, T>(fn: (args: Args) => Promise<T> | T, opts?: CellOptions): Cell<Args, T> {
  const ttl = opts?.ttl ?? Infinity;
  const id = opts?.key ?? `cell#${++cellCounter}`;
  // `shared` is server-only; on the client it is inert (falls through to the client context cache).
  const shared = opts?.shared === true && !isBrowser;
  const notify = opts?.notify;
  // Tags are honored only on a shared (server) cell — the tag registry is a server concept.
  const tags = shared ? opts?.tags ?? [] : [];

  // Fire the broadcast sink for a slot-changing verb — ONLY on a shared cell (broadcast is a
  // shared-slot concept). Transport-free: the cell just calls the injected function.
  function broadcast(verb: "invalidate" | "refresh" | "amend", args: unknown, value?: unknown): void {
    if (shared && notify !== undefined) notify(verb, args, value);
  }
  // Namespace slots within the backing cache map. \x00 keeps the prefix distinct from any
  // canonicalKey output.
  const prefix = `\x00cell\x00${id}\x00`;

  // The cache Map backing this cell's slots: the process-global shared store for a `shared` cell,
  // otherwise the ambient per-context cache (per-request on the server, singleton on the client).
  function slotCache(): Map<string, unknown> {
    return shared ? sharedStore() : getContext().cache;
  }

  // The LRU-bounded store backing `cache`, if any. Only the shared store and the persistent server
  // default context are bounded by ABIDE_MAX_SHARED_CACHE_SIZE; per-request caches die with the
  // request and the client cache dies with the tab, so neither is bounded.
  function boundedStore(cache: Map<string, unknown>): Map<string, unknown> | undefined {
    if (isBrowser) return undefined;
    if (cache === sharedStore() || cache === serverDefaultCache()) return cache;
    return undefined;
  }

  // Fail-closed checkpoint (b), rpc-core §2: a shared read must run inside an active request scope
  // (an authorized caller). A bare script/cron read has no gate and no client to serve, so it
  // throws rather than silently touching the cross-request store. Server-only; inert on the client.
  function guardSharedRead(): void {
    if (shared && currentScope() === undefined) {
      throw new Error("shared cell read requires an active request scope");
    }
  }

  // Move a bounded slot to MRU on read so LRU eviction drops least-recently-read first.
  function touchOnRead(slot: Slot<Args, T>): void {
    if (!shared && isBrowser) return;
    const store = boundedStore(slotCache());
    if (store !== undefined) sharedCacheTouch(store, slot.key);
  }

  function ensureSlot(args: Args): Slot<Args, T> {
    const cache = slotCache();
    const cacheKey = prefix + canonicalKey(args);
    let slot = cache.get(cacheKey) as Slot<Args, T> | undefined;
    if (slot === undefined) {
      slot = { args, key: cacheKey, signal: signal(idleState<T>()), inflight: null, loadedAt: 0, generation: 0 };
      cache.set(cacheKey, slot);
    }
    return slot;
  }

  // Every slot belonging to this cell in the active context (optionally filtered by selector).
  function selectSlots(selector: Partial<Args> | Args | undefined): Slot<Args, T>[] {
    const cache = slotCache();
    const result: Slot<Args, T>[] = [];
    for (const [cacheKey, entry] of cache) {
      if (typeof cacheKey !== "string" || !cacheKey.startsWith(prefix)) continue;
      const slot = entry as Slot<Args, T>;
      if (selector === undefined || matchesSelector(slot.args, selector)) result.push(slot);
    }
    return result;
  }

  function isExpired(slot: Slot<Args, T>): boolean {
    if (ttl === Infinity) return false;
    const state = slot.signal.peek();
    if (state.status === "stream") {
      // An OPEN stream is retained regardless of ttl (§2); a CLOSED one expires on the ttl-from-close
      // clock (`loadedAt` is stamped when the ReplayableStream settles, not when `fn` resolved).
      const stream = state.stream;
      if (stream === undefined || !stream.settled) return false;
      return Date.now() - slot.loadedAt >= ttl;
    }
    if (state.status !== "value" && state.status !== "error") return false;
    return Date.now() - slot.loadedAt >= ttl;
  }

  function setState(slot: Slot<Args, T>, next: SlotState<T>): void {
    slot.signal.set(next);
  }

  // Begin (or coalesce onto) a load for this slot. `keepStale` retains the current value and
  // flips `refreshing` on instead of dropping to a bare pending state.
  function startLoad(slot: Slot<Args, T>, keepStale: boolean): Promise<T> {
    if (slot.inflight !== null) return slot.inflight;

    const current = slot.signal.peek();
    if (keepStale && current.status === "value") {
      setState(slot, { status: "value", value: current.value, error: undefined, refreshing: true });
    } else {
      setState(slot, { status: "pending", value: undefined, error: undefined, refreshing: false });
    }

    const generation = slot.generation;
    const runLoad = (): Promise<T> =>
      (async () => {
        try {
          const produced = await fn(slot.args);
          if (slot.generation !== generation) return produced as T; // superseded — discard silently
          // See through a json()/jsonl()/sse() wrapper to its pre-encoding payload, so a wrapped result
          // caches/streams exactly like the raw form (replayable-streams.md §4).
          const tagged = responseSourceOf(produced);
          // Streaming read: wrap the source in a ReplayableStream and resolve to it; the read maps that
          // to a fresh `consume()` cursor per caller (see coalescedLoad/mapRead). The source runs once.
          if (tagged?.kind === "stream") {
            return startStream(slot, tagged.source, tagged.encoding) as unknown as T;
          }
          if (isStreamSource(produced)) {
            return startStream(slot, produced) as unknown as T;
          }
          const value = tagged?.kind === "value" ? (tagged.value as T) : produced;
          slot.loadedAt = Date.now();
          setState(slot, { status: "value", value, error: undefined, refreshing: false });
          recordAndEvict(slot, value);
          return value;
        } catch (caught) {
          if (slot.generation === generation) {
            slot.loadedAt = Date.now();
            setState(slot, { status: "error", value: undefined, error: caught, refreshing: false });
          }
          throw caught;
        } finally {
          if (slot.generation === generation) slot.inflight = null;
        }
      })();

    // Fail-closed checkpoint (a), rpc-core §2: a shared handler runs OUTSIDE the request scope, so
    // identity()/cookies()/request()/context() throw if it touches request scope → the read rejects
    // (error slot) and the value is never cached, in dev AND prod. A nested non-shared cell lands in
    // the neutral default context. Non-shared cells keep running in the ambient scope.
    const promise = shared ? runOutsideScope(runLoad) : runLoad();

    slot.inflight = promise;
    return promise;
  }

  // On settle, record the value's JSON byte size and evict LRU entries over the ceiling — but only
  // for the two bounded server stores (shared + default context). No-op when unbounded.
  function recordAndEvict(slot: Slot<Args, T>, value: T): void {
    const store = boundedStore(slotCache());
    if (store === undefined) return;
    sharedCacheRecordSize(store, slot.key, measureBytes(value));
    sharedCacheEvictIfNeeded(store);
  }

  // Remove a slot from the backing map entirely — distinct from dropSlot (which resets to idle but
  // KEEPS the slot so existing subscriptions stay live). Used for stream dispose-on-drain (§2): a
  // settled ttl:0 stream, or a stream every consumer abandoned, is gone and the next read is a cold run.
  function disposeSlot(slot: Slot<Args, T>): void {
    slot.generation++;
    slot.inflight = null;
    const cache = slotCache();
    const store = boundedStore(cache);
    if (store !== undefined) sharedCacheUnpin(store, slot.key); // never leave a disposed key pinned
    cache.delete(slot.key);
  }

  // Last consumer of a stream slot detached (ref-count hit 0). Dispose a settled ttl:0 slot; for a
  // still-open stream everyone abandoned, abort the source unless it is a retained (shared, ttl>0) run
  // that should complete for a late joiner (§2 empty-refcount policy).
  function onStreamRefCountZero(slot: Slot<Args, T>, stream: ReplayableStream<unknown>): void {
    // A stale callback (the slot already re-ran into a NEW stream under the same key) must not touch it.
    if (slot.signal.peek().stream !== stream) return;
    if (stream.settled) {
      // Dispose a ttl:0 slot, or an OVERFLOWED transcript (never retained for replay), on drain.
      if (ttl === 0 || stream.overflowed) disposeSlot(slot);
      return;
    }
    if (!(shared && ttl > 0)) {
      stream.abort();
      disposeSlot(slot);
    }
  }

  // Wrap a streaming source in a ReplayableStream on the slot and pump the source into it exactly once.
  // Concurrent/late reads fan out via `consume()` (a fresh cursor each); the source is never re-run.
  function bumpStreamTick(slot: Slot<Args, T>): void {
    const tick = slot.streamTick;
    if (tick !== undefined) tick.set(tick.peek() + 1);
  }

  // Incremental per-chunk accounting (replayable-streams.md §4): grow the slot's recorded size as the
  // transcript grows so an OPEN stream pressures the LRU live, and OVERFLOW past the per-stream cap so a
  // runaway can't grow unbounded. Only the two bounded server stores account; per-request/client don't.
  function accountStreamChunk(slot: Slot<Args, T>, stream: ReplayableStream<unknown>): void {
    if (slot.signal.peek().stream !== stream) return; // stale (slot re-ran)
    const store = boundedStore(slotCache());
    if (store === undefined) return;
    if (stream.bytes > streamBufferCap()) {
      stream.markOverflowed(); // abort + drop replay eligibility; buffer stops growing
      return;
    }
    sharedCacheRecordSize(store, slot.key, stream.bytes);
    sharedCacheEvictIfNeeded(store); // evicts OTHER closed slots; this open stream is pinned
  }

  function startStream(slot: Slot<Args, T>, source: AsyncIterable<unknown> | Iterable<unknown>, encoding?: "jsonl" | "sse"): ReplayableStream<unknown> {
    const controller = new AbortController();
    // A reactive tick for chunk-level probes (peek/chunks/done). Reused across re-runs of this slot.
    if (slot.streamTick === undefined) slot.streamTick = signal(0);
    const stream = new ReplayableStream<unknown>({
      onAbort: () => controller.abort(),
      onRefCountZero: () => onStreamRefCountZero(slot, stream),
      onPush: () => {
        bumpStreamTick(slot);
        accountStreamChunk(slot, stream);
      },
    });
    stream.encoding = encoding; // carried so the router re-serves the handler's chosen wire format
    // Pin an open stream against LRU eviction while it fills (bounded store only).
    const store = boundedStore(slotCache());
    if (store !== undefined) sharedCachePin(store, slot.key);
    setState(slot, { status: "stream", value: undefined, error: undefined, refreshing: false, stream });
    void (async () => {
      try {
        for await (const chunk of source) {
          if (controller.signal.aborted) break;
          stream.push(chunk);
        }
        stream.close();
      } catch (caught) {
        stream.fail(caught);
      } finally {
        // Only touch the slot if it STILL holds this stream (not superseded by an invalidate/re-run).
        if (slot.signal.peek().stream === stream) {
          // TTL-from-close (§2): the retention clock starts when the transcript settles, not at fn-resolve.
          slot.loadedAt = Date.now();
          // The transcript is now a CLOSED value: unpin (LRU-evictable) and record its final size.
          if (store !== undefined) {
            sharedCacheUnpin(store, slot.key);
            sharedCacheRecordSize(store, slot.key, stream.bytes);
            sharedCacheEvictIfNeeded(store);
          }
        }
        bumpStreamTick(slot); // reflect the terminal (done/error) to reactive probes
      }
    })();
    return stream;
  }

  // Reactive-peek read path: subscribe to the slot, kick a coalesced load when cold or expired.
  function readReactive(slot: Slot<Args, T>): T | undefined {
    const state = slot.signal();
    untrack(() => {
      if (slot.inflight !== null) return;
      if (state.status === "idle") {
        startLoad(slot, false);
      } else if (isExpired(slot)) {
        startLoad(slot, state.status === "value");
      }
    });
    return state.value;
  }

  // Reactive STREAM probe: subscribe to the state machine AND (while streaming) the chunk tick, kick a
  // cold load if idle, then project the live transcript via `select`. Returns undefined for a non-stream
  // / not-yet-streaming slot. Distinct from readReactive so it never restarts the bare `{#for await}`.
  function readStreamReactive<R>(slot: Slot<Args, T>, select: (chunks: readonly unknown[], stream: ReplayableStream<unknown>) => R): R | undefined {
    const state = slot.signal();
    untrack(() => {
      if (slot.inflight === null && state.status === "idle") startLoad(slot, false);
    });
    if (state.status !== "stream" || state.stream === undefined) return undefined;
    if (slot.streamTick !== undefined) slot.streamTick(); // subscribe to chunk progress + terminal
    return select(state.stream.chunks, state.stream);
  }

  // A fresh per-consumer cursor over a shared stream, stamped with the handler's wire encoding so the
  // router re-serves jsonl/sse after replay.
  function streamCursor(stream: ReplayableStream<unknown>): T {
    const cursor = stream.consume();
    if (stream.encoding !== undefined) tagStreamEncoding(cursor, stream.encoding);
    return cursor as unknown as T;
  }

  // A stream slot resolves (inflight or settled) to the SHARED ReplayableStream; each caller must get its
  // OWN cursor. mapRead turns that shared stream into a fresh `consume()` per read; a scalar passes through.
  function mapRead(resolved: T): T {
    return resolved instanceof ReplayableStream ? streamCursor(resolved) : resolved;
  }

  // The coalesced-load core: return the in-flight promise, the settled value/error/stream cursor, or
  // start a load. Non-reactive on its own (uses `signal.peek()`); the bare call adds the subscription.
  function coalescedLoad(slot: Slot<Args, T>): Promise<T> {
    const state = slot.signal.peek();
    // A settled/open stream slot hands back a fresh cursor over the shared buffer with no re-run — unless
    // it OVERFLOWED (not a valid replay target), in which case fall through to a fresh run.
    if (state.status === "stream" && state.stream !== undefined && !state.stream.overflowed && !isExpired(slot)) {
      return Promise.resolve(streamCursor(state.stream));
    }
    if (slot.inflight !== null) return slot.inflight.then(mapRead);
    if (!isExpired(slot)) {
      // A seed-primed / already-loaded slot resolves synchronously — tag the promise so attach-
      // hydration can claim the server-rendered `{#await fn()}` branch instead of re-mounting.
      if (state.status === "value") return markSettled(Promise.resolve(state.value as T), state.value as T);
      if (state.status === "error") return Promise.reject(state.error);
    }
    return startLoad(slot, state.status === "value").then(mapRead);
  }

  // THE READ (Promise-read model): the bare call is the awaitable coalesced load AND subscribes the
  // calling reactive context to the slot (the tracked `slot.signal()` read). So a reactive `{await
  // cell()}` / `{#await cell()}` re-runs and re-awaits when the slot invalidates — the crux the model
  // needed. The load itself runs untracked (it reads `signal.peek()`), so only the subscription tracks.
  const c = ((args: Args) => {
    guardSharedRead();
    const slot = ensureSlot(args);
    touchOnRead(slot);
    slot.signal();
    return untrack(() => coalescedLoad(slot));
  }) as Cell<Args, T>;

  // @deprecated alias for the bare call, minus the reactive subscription (back-compat during migration).
  c.load = (args: Args): Promise<T> => {
    guardSharedRead();
    const slot = ensureSlot(args);
    touchOnRead(slot);
    return coalescedLoad(slot);
  };

  // Reactive PEEK: the non-blocking snapshot — subscribes and kicks a coalesced load when cold. For a
  // VALUE slot: the current value (or undefined while pending). For a STREAM slot: the current value is
  // the MOST-RECENT chunk (replayable-streams.md §4), reactive on chunk arrival. Use `chunks()` for the
  // whole transcript.
  c.peek = (args: Args): T | undefined => {
    guardSharedRead();
    const slot = ensureSlot(args);
    touchOnRead(slot);
    if (slot.signal.peek().status === "stream") {
      return readStreamReactive(slot, (chunks) => (chunks.length > 0 ? chunks[chunks.length - 1] : undefined)) as T | undefined;
    }
    return readReactive(slot);
  };

  c.pending = (args: Args): boolean => ensureSlot(args).signal().status === "pending";

  c.error = (args: Args): unknown => {
    const slot = ensureSlot(args);
    const state = slot.signal();
    // A stream's error lives on the ReplayableStream, not the slot state; surface it reactively.
    if (state.status === "stream" && state.stream !== undefined) {
      if (slot.streamTick !== undefined) slot.streamTick();
      return state.stream.error;
    }
    return state.error;
  };

  // Reactive stream probes (replayable-streams.md §4): full transcript snapshot, closed? (`peek()` above
  // gives the most-recent chunk — the "current value").
  c.chunks = (args: Args): unknown[] | undefined => {
    guardSharedRead();
    const slot = ensureSlot(args);
    touchOnRead(slot);
    return readStreamReactive(slot, (chunks) => chunks.slice());
  };
  c.done = (args: Args): boolean => {
    guardSharedRead();
    const slot = ensureSlot(args);
    touchOnRead(slot);
    return readStreamReactive(slot, (_chunks, stream) => stream.done) ?? false;
  };

  c.resumeStream = (args: Args, from: number): { cursor: AsyncIterable<unknown> | undefined; fresh: boolean } => {
    guardSharedRead();
    const slot = ensureSlot(args);
    const state = slot.signal.peek();
    // A retained, non-overflowed transcript is resumable — replay from `from` then continue live.
    if (state.status === "stream" && state.stream !== undefined && !state.stream.overflowed && !isExpired(slot)) {
      touchOnRead(slot);
      return { cursor: state.stream.consume(from), fresh: false };
    }
    return { cursor: undefined, fresh: true }; // slot gone/evicted → caller runs fresh from 0
  };

  c.refreshing = (args: Args): boolean => ensureSlot(args).signal().refreshing;

  c.refresh = (args?: Partial<Args> | Args): void => {
    const slots = selectSlots(args);
    for (let i = 0; i < slots.length; i++) startLoad(slots[i]!, true);
    broadcast("refresh", args);
  };

  // Drop one slot back to idle: bump generation so a superseded in-flight load discards its result,
  // clear coalescing, and notify subscribers by resetting the (retained) signal to idle -> lazy
  // reload on next read. The slot stays in the map so existing subscriptions stay live.
  function dropSlot(slot: Slot<Args, T>): void {
    const state = slot.signal.peek();
    // Invalidating an OPEN stream aborts its source and gracefully ends live consumers (§4) — a value
    // slot has nothing to tear down.
    if (state.status === "stream" && state.stream !== undefined && !state.stream.settled) {
      state.stream.abort();
    }
    slot.generation++;
    slot.inflight = null;
    slot.loadedAt = 0;
    setState(slot, idleState<T>());
  }

  c.invalidate = (args?: Partial<Args> | Args): void => {
    const slots = selectSlots(args);
    for (let i = 0; i < slots.length; i++) dropSlot(slots[i]!);
    broadcast("invalidate", args);
  };

  c.amend = (args: Args, next: T | ((current: T | undefined) => T)): void => {
    const slot = ensureSlot(args);
    const current = slot.signal.peek();
    let value: T;
    if (typeof next === "function") {
      // Updater-form. A closure can't cross the wire (rpc-core §2 tension): on a SHARED slot the
      // updater runs against the durable value here, then broadcasts its RESULT as a value-form
      // frame. A SERVER per-request (non-shared) slot inside a request scope has nothing durable to
      // broadcast an updater against → error. On the client (or a bare/default-context server call
      // with no request scope), an updater-form amend stays a local mutation.
      if (!shared && !isBrowser && currentScope() !== undefined) {
        throw new Error("amend updater-form is not supported on a per-request cell; pass a value instead");
      }
      value = untrack(() => (next as (current: T | undefined) => T)(current.value));
    } else {
      value = next;
    }
    setState(slot, { status: "value", value, error: undefined, refreshing: current.refreshing });
    // Both forms broadcast the resolved VALUE (value-form frame) on a shared slot.
    broadcast("amend", args, value);
  };

  c.snapshot = (): Array<{ args: Args; value: T }> =>
    untrack(() => {
      const result: Array<{ args: Args; value: T }> = [];
      for (const slot of selectSlots(undefined)) {
        const state = slot.signal.peek();
        if (state.status === "value") result.push({ args: slot.args, value: state.value as T });
      }
      return result;
    });

  c.seed = (args: Args, value: T): void => {
    const slot = ensureSlot(args);
    slot.loadedAt = Date.now();
    setState(slot, { status: "value", value, error: undefined, refreshing: false });
  };

  c.watch = (args: Args, handler: (value: T | undefined) => void): (() => void) => {
    const slot = ensureSlot(args);
    let first = true;
    return effect(() => {
      const state = slot.signal();
      if (first) {
        first = false;
        return;
      }
      untrack(() => handler(state.value));
    });
  };

  // Tag registry hooks (rpc-core §8, PR4). A shared cell carrying tags registers these so the global
  // `invalidate/refresh({ tags })` selectors can act on it. Tag invalidate/refresh act on ALL current
  // slots and broadcast PER SLOT on that slot's `(rpc,args)` channel (unlike a bare-args verb, which
  // broadcasts once for the selector) so per-args subscribers each receive their own frame. pending/
  // refreshing are LOCAL reactive aggregates over the cell's current slot signals — no broadcast.
  function invalidateForTags(): void {
    for (const slot of selectSlots(undefined)) {
      dropSlot(slot);
      broadcast("invalidate", slot.args);
    }
  }
  function refreshForTags(): void {
    for (const slot of selectSlots(undefined)) {
      startLoad(slot, true);
      broadcast("refresh", slot.args);
    }
  }
  function anyPendingForTags(): boolean {
    let any = false;
    for (const slot of selectSlots(undefined)) {
      if (slot.signal().status === "pending") any = true;
    }
    return any;
  }
  function anyRefreshingForTags(): boolean {
    let any = false;
    for (const slot of selectSlots(undefined)) {
      if (slot.signal().refreshing) any = true;
    }
    return any;
  }

  if (shared && tags.length > 0) {
    registerTaggedCell({ tags, invalidate: invalidateForTags, refresh: refreshForTags, pending: anyPendingForTags, refreshing: anyRefreshingForTags });
  }

  return c;
}
