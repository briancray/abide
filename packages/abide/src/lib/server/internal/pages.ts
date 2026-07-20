// SERVER-SIDE PAGE SSR (M5a) — abide-compiler C6 (pages/routing), C6-nav (first load = full SSR).
//
// `renderPage` assembles a `page.abide` source and renders it inside the CURRENT request scope,
// producing the inner SSR HTML. In-template RPC reads (C3) run in-proc through the cell during
// render, so the page's data lands inline in the HTML. `renderDocument` wraps that inner HTML in a
// full HTML document with the hydration-seed script placeholder.
//
// The page's stripped `import` bindings are resolved by name against an injected map merging (a) the
// app's RPC callables (keyed by route name) and (b) the standard ambient accessors a page may import
// (route/identity/request/cookies). Real module-swap resolution is M3b.
//
// The §5 hydration seed payload (`collectSeed`) records every RPC read the page resolved during SSR
// — as `{ reads: [{ name, args, value }] }`, each value trimmed to its output schema — so the client
// replays them from cache instead of re-fetching on hydration. An empty seed serialises to `{}`.

import { loadEmittedServer } from "../../ui/internal/emit.ts";
import { Raw } from "../../ui/internal/serverRuntime.ts";
import { applicableLayoutPrefixes } from "./layouts.ts";
import { state } from "../../ui/state.ts";
import type { State, StateCell } from "../../ui/state.ts";
import { getContext, runInContext } from "../../shared/internal/context.ts";
import type { CacheContext } from "../../shared/internal/context.ts";
import { createStreamScope, documentPatch, drainPatches } from "../../ui/internal/streamScope.ts";
import { watch } from "../../ui/watch.ts";
import { route } from "../../shared/route.ts";
import { url } from "../../shared/url.ts";
import { identity } from "../identity.ts";
import { request } from "../request.ts";
import { cookies } from "../cookies.ts";
import { shapeToSchema, jsonSchemaOf } from "../../shared/internal/shapeToSchema.ts";
import type { AppConfig, Route } from "./router.ts";
import type { Rpc } from "./makeRpc.ts";

// Wrap one route as the value a page sees under its name. Under the Promise-read model the read's
// bare call IS the coalesced load (`await greet(args)` → the value); SSR awaits it into the HTML.
// `.peek()` is the sync `T | undefined` snapshot. Probe/verb methods are carried through for parity.
// Mutations are already promise-returning callables, passed through untouched.
function pageCallable(entry: Route): unknown {
  if (entry.__rpc.read !== true) return entry;
  const rpc = entry as Rpc<unknown, unknown>;
  const callable = (args: unknown): Promise<unknown> => rpc(args);
  return Object.assign(callable, {
    peek: rpc.peek,
    load: rpc.load,
    pending: rpc.pending,
    refreshing: rpc.refreshing,
    error: rpc.error,
    watch: rpc.watch,
    raw: rpc.raw,
    isError: rpc.isError,
    refresh: rpc.refresh,
    invalidate: rpc.invalidate,
    amend: rpc.amend,
    snapshot: rpc.snapshot,
    seed: rpc.seed,
    __rpc: rpc.__rpc,
  });
}

// Build the imports map: RPC callables by route name, then the ambient accessors (added last so a
// standard accessor name always resolves to the accessor).
function pageImports(routes: Record<string, Route>): Record<string, unknown> {
  const imports: Record<string, unknown> = {};
  for (const name of Object.keys(routes)) {
    imports[name] = pageCallable(routes[name]!);
  }
  imports.route = route;
  imports.url = url;
  imports.identity = identity;
  imports.request = request;
  imports.cookies = cookies;
  return imports;
}

// Render a page source to its inner SSR HTML inside the active request scope, through the AOT-emitted
// server module (`loadEmittedServer(source).render($scope)`). The server-only loader never imports
// the emitted client module, so SSR stays DOM-free and cached per source.
//
// The emitted `render($scope)` looks up each `<script>` import by its local name via `$scope[local]`,
// so the merged scope is `pageImports` plus the framework bindings a page may import (state/watch/
// props). RPC callables are the request-scoped `pageCallable`s, so in-proc reads land in the cache
// during render and `collectSeed` records them.
// The `state` binding a page sees during SSR: a thin recorder over the real `state`. Each `state(...)`
// call pushes its RAW initial (pre-transform) onto `getContext().states` IN CALL ORDER, then delegates
// to the real cell factory (behaviour identical). We record the raw initial — not the post-transform
// value — because the client replays it as `state(seed, transform)`, so the transform is re-applied
// there; recording the post-transform value would double-apply it. `.computed`/`.linked` are passed
// through untouched (they carry no serializable initial and never consume a seed slot on the client),
// so the ordinal count stays identical on both sides. See §5 / attach-hydration-design decision 10.
const recordingState: State = Object.assign(
  function recordState<T>(initial: T, transform?: (value: T) => T): StateCell<T> {
    getContext().states.push(initial);
    return state(initial, transform);
  } as State,
  // `.computed`/`.linked`/`.shared` don't record a seed slot (`.shared` is keyed, not ordinal).
  { computed: state.computed, linked: state.linked, shared: state.shared },
);

// Render one composed level (a layout or the page) to its inner SSR HTML. When a deeper level exists,
// inject `children` into the scope as a server component (`(props, childrenFn) => Raw`) that renders
// the NEXT level on demand — so the layout's `{children()}` component slot (templatePlan) emits it in
// place, wrapped in the paired block anchors the client hydrate walk expects. Rendering the child
// lazily (when the parent hits `{children()}`) records `state(...)` in outer→inner call order, which
// matches the client mount order so the hydration-seed ordinals line up (§5 / decision 10).
// `dirs[index]` is the source dir of `levels[index]` (a layout's or the page's `.abide` file dir),
// used to resolve that level's `.abide` component imports against the filesystem during SSR.
async function renderLevel(levels: string[], dirs: (string | undefined)[], index: number, imports: Record<string, unknown>): Promise<string> {
  const emitted = await loadEmittedServer(levels[index]!, dirs[index]);
  const scope: Record<string, unknown> = { ...imports, state: recordingState, watch, props: () => ({}) };
  if (index + 1 < levels.length) {
    scope.children = async (): Promise<Raw> => new Raw(await renderLevel(levels, dirs, index + 1, imports));
  }
  return emitted.render(scope);
}

// Render a page (and its applicable layouts) to inner SSR HTML in the active request scope. `pattern`
// is the matched route pattern; its layout chain (root → nearest, TODO #7) wraps the page outer→inner.
// A parallel `dirs` array carries each level's source dir (layouts keyed by prefix in `layoutDirs`,
// the page by `pattern` in `pageDirs`) so each level resolves its own `.abide` component imports.
// When `streaming` is true (first-load full document), install the per-render stream scope so a
// streaming-form `{#await}` read that blocks past the deadline defers instead of holding the render —
// the returned string is the SHELL (placeholders for deferred subtrees), whose deferreds live on the
// request context for `streamPageDocument` to drain. When false (soft-nav / tests), no stream scope is
// installed → `awaitStream` awaits fully inline, so the returned string is the COMPLETE inner HTML.
export async function renderPage(source: string, config: AppConfig, pattern?: string, streaming = false): Promise<string> {
  if (streaming) getContext().stream = createStreamScope();
  const imports = pageImports(config.routes ?? {});
  const layouts = config.layouts ?? {};
  const layoutDirs = config.layoutDirs ?? {};
  const pageDirs = config.pageDirs ?? {};
  const prefixes = pattern !== undefined ? applicableLayoutPrefixes(pattern, layouts) : [];
  const levels = [...prefixes.map((prefix) => layouts[prefix]!), source];
  const dirs = [...prefixes.map((prefix) => layoutDirs[prefix]), pattern !== undefined ? pageDirs[pattern] : undefined];
  return renderLevel(levels, dirs, 0, imports);
}

// Pre-compile every page and layout `.abide` source at serve start so the AOT emit (parse → analyze →
// emit → temp-module import, plus each level's `.abide` component tree) happens ONCE up front rather
// than lazily on the first request that hits each page. `loadEmittedServer` only COMPILES (it never
// renders), so this needs no request scope. Priming `SERVER_MODULE_CACHE` removes the first-hit
// latency that otherwise races a parallel wave of requests (the docs Playwright e2e flaked under
// `fullyParallel` because the first workers all raced the on-demand compile — see TODO test-coverage
// gap). Compiles concurrently; a per-level failure is logged and skipped so a single broken page never
// blocks boot (the real request re-surfaces the error). No-op when the config declares no pages.
export async function warmPages(config: AppConfig): Promise<void> {
  const pages = config.pages ?? {};
  const pageDirs = config.pageDirs ?? {};
  const layouts = config.layouts ?? {};
  const layoutDirs = config.layoutDirs ?? {};
  const jobs: Promise<unknown>[] = [];
  for (const routePath of Object.keys(pages)) {
    jobs.push(warmLevel(pages[routePath]!, pageDirs[routePath], `page ${routePath}`));
  }
  for (const prefix of Object.keys(layouts)) {
    jobs.push(warmLevel(layouts[prefix]!, layoutDirs[prefix], `layout ${prefix}`));
  }
  await Promise.all(jobs);
}

async function warmLevel(source: string, dir: string | undefined, label: string): Promise<void> {
  try {
    await loadEmittedServer(source, dir);
  } catch (caught) {
    console.error(`[abide] page warmup failed for ${label}:`, caught instanceof Error ? caught.message : String(caught));
  }
}

// One recorded SSR read for the hydration seed: the RPC route name, the args it was called with, and
// the (output-shaped) value it resolved to.
export interface SeedRead {
  name: string;
  args: unknown;
  value: unknown;
}

// One attachable `{#for await}` stream handed off to the client (replayable-streams.md §5). `listId`
// matches the `<abide-list id>` the SSR painted; `name`/`args` identify the source RPC for a mode-B
// resume (`GET /rpc/<name>?args=…&from=<count>`); `done` picks the mode (true → adopt `values`, false
// → resume); `count` is the flushed item count (= `values.length`); `values` is the decoded transcript
// so mode A re-mounts with zero network. `values` is absent only if it wasn't JSON-serializable.
export interface StreamHandle {
  listId: string;
  name: string | null;
  args: unknown;
  done: boolean;
  count: number;
  values?: unknown[];
}

// The hydration seed payload. Empty (`{}`) when the page resolved no reads and declared no state.
export interface HydrationSeed {
  reads?: SeedRead[];
  // Recorded `state(initial)` initials, in call order, so the client seeds each cell with the same
  // value the server rendered (decision 10). Present only when the page declared state. Values must be
  // JSON-serializable (the seed contract); a non-serializable initial is recorded as `null` rather
  // than crashing the render.
  states?: unknown[];
  // Attachable `{#for await}` handoff records (§5). Present only when the page streamed a known-RPC
  // source; the client adopts/resumes each instead of re-invoking the source on hydrate.
  streams?: StreamHandle[];
}

// Keep a recorded state initial JSON-serializable so serialising the seed never throws (a non-JSON
// value — e.g. BigInt, circular — is dropped to `null`; documented seed-contract limitation). Returns
// the value unchanged when it round-trips, preserving the ordinal (never drops an entry).
function jsonSafeState(value: unknown): unknown {
  try {
    JSON.stringify(value);
    return value;
  } catch {
    return null;
  }
}

// Record every RPC read resolved during this SSR render into the hydration seed (rpc-core §5). MUST
// run inside the same request scope as `renderPage` — it reads each read-RPC's resolved cache slots
// via `snapshot()`. Values are trimmed to the declared output schema (output-shaping, §5.2) so no
// undeclared field reaches the client. Returns `{}` when nothing was read (keeping the seed script
// and soft-nav envelope byte-identical to the pre-seed behaviour for read-free pages).
export function collectSeed(config: AppConfig): HydrationSeed {
  const routes = config.routes ?? {};
  const reads: SeedRead[] = [];
  for (const name of Object.keys(routes)) {
    const entry = routes[name]!;
    if (entry.__rpc.read !== true) continue;
    const rpc = entry as Rpc<unknown, unknown>;
    const outputSchema = jsonSchemaOf(rpc.__rpc.options.schemas?.output);
    for (const record of rpc.snapshot()) {
      reads.push({ name, args: record.args, value: shapeToSchema(record.value, outputSchema) });
    }
  }
  // State initials recorded during this SSR render (same request scope as `renderPage`), in call order.
  const recorded = getContext().states;
  const seed: HydrationSeed = {};
  if (reads.length > 0) seed.reads = reads;
  if (recorded.length > 0) seed.states = recorded.map(jsonSafeState);
  // Attachable `{#for await}` handoffs recorded during this render (§5). Values/args are JSON-safed
  // like state initials — a non-serializable entry drops to `null` rather than crashing the seed. The
  // decoded values leak nothing the SSR HTML did not already paint.
  const streamRecords = getContext().stream?.streamHandles;
  if (streamRecords !== undefined && streamRecords.length > 0) {
    seed.streams = streamRecords.map((record) => ({
      listId: record.listId,
      name: record.name,
      args: jsonSafeState(record.args),
      done: record.done,
      count: record.count,
      values: record.values.map(jsonSafeState),
    }));
  }
  return seed;
}

export interface RenderDocumentOptions {
  title?: string;
  // BP2.3: dev-only inline JS wired into the document as a `<script>` — the live-reload client.
  // Absent in production (and in every existing test), so the emitted document is unchanged there.
  devReloadScript?: string | undefined;
  // The §5 hydration seed to inline into `#__abide-seed`. Absent → the empty `{}` payload.
  seed?: HydrationSeed | undefined;
  // TODO #20: when true, link the bundled client stylesheet (`/__abide/client.css`) in `<head>`. Set
  // only when the app actually bundled CSS, so CSS-free apps emit the same document as before.
  styles?: boolean | undefined;
}

const DOCUMENT_TITLE_ESCAPE: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };

function escapeTitle(value: string): string {
  return value.replace(/[&<>]/g, (char) => DOCUMENT_TITLE_ESCAPE[char]!);
}

// Serialise the seed for embedding in a `<script type="application/json">`. `<` is escaped to its
// `<` JSON escape so a value containing `</script>` cannot break out of the script element while
// the payload stays valid JSON the client parses back verbatim.
function serialiseSeed(seed: HydrationSeed | undefined): string {
  return JSON.stringify(seed ?? {}).replace(/</g, "\\u003c");
}

// The document split around the inner SSR HTML: `documentHead` is everything up to and including the
// app container's opening tag (seed-independent, so it can flush before any read settles); the tail is
// the container close plus the hydration-seed + client scripts (needs the seed, computed only AFTER the
// shell + streamed patches). `renderDocument` (`head + inner + tail`) stays byte-identical to the
// pre-streaming output for the buffered callers/tests.
export function documentHead(opts?: RenderDocumentOptions): string {
  const title = escapeTitle(opts?.title ?? "abide");
  const stylesheet = opts?.styles === true ? `<link rel="stylesheet" href="/__abide/client.css">` : "";
  return (
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>${stylesheet}</head>` +
    `<body><div id="__abide-app">`
  );
}

export function documentTail(seed: HydrationSeed | undefined, opts?: RenderDocumentOptions): string {
  const devReload =
    opts?.devReloadScript !== undefined && opts.devReloadScript.length > 0
      ? `<script id="__abide-dev-reload">${opts.devReloadScript}</script>`
      : "";
  return (
    `</div>` +
    `<script type="application/json" id="__abide-seed">${serialiseSeed(seed)}</script>` +
    `<script type="module" src="/__abide/client.js"></script>${devReload}</body></html>`
  );
}

// Wrap inner SSR HTML in a full HTML document, inlining the §5 hydration seed so the client replays
// SSR-computed reads instead of re-fetching them. Buffered/byte-identical (the seed rides in `opts`).
export function renderDocument(inner: string, opts?: RenderDocumentOptions): string {
  return documentHead(opts) + inner + documentTail(opts?.seed, opts);
}

// The streaming SSR transport (PR2). Serves `head → shell → out-of-order patches → tail` over a
// `ReadableStream`. The shell (first-load render of the SHELL string, with `<abide-slot>` placeholders
// for any read that blocked past the deadline) flushes immediately; each deferred subtree streams as a
// `<template>` + move-script patch when it resolves; the seed is collected AFTER the patches drain
// (so streamed reads are included — PR2 keeps one tail seed; PR3 splits it per-patch) and the tail
// flushes last. The drain + `collectSeed` run inside the captured request context so they read the
// same request cache. The render-error → 500 guarantee holds: `renderPage` (which awaits blocking
// reads) has already returned before this stream is constructed.
export function streamPageDocument(
  shell: string,
  ctx: CacheContext,
  config: AppConfig,
  opts?: RenderDocumentOptions,
): ReadableStream<Uint8Array> {
  const stream = ctx.stream;
  const encoder = new TextEncoder();
  const head = documentHead(opts);
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = (chunk: string): void => controller.enqueue(encoder.encode(chunk));
      enc(head);
      enc(shell);
      try {
        if (stream !== undefined && (stream.deferred.length > 0 || stream.streamers.length > 0)) {
          await runInContext(ctx, async () => {
            for await (const patch of drainPatches(stream)) enc(documentPatch(patch));
          });
        }
      } catch (caught) {
        console.error("[abide] streaming SSR drain failed:", caught);
      }
      const seed = runInContext(ctx, () => collectSeed(config));
      enc(documentTail(seed, opts));
      controller.close();
      ctx.stream = undefined; // per-render scope — never leak deferreds onto a reused context.
    },
  });
}

// The STREAMING soft-nav transport (PR4). An in-app navigation streams a JSONL frame stream instead of
// the old buffered `{html, seed}` JSON envelope, so a slow read shows the shell then streams in — same
// as first load. Frames (one JSON object per line): `{kind:"shell", html, url}` first (the client
// swaps it into `#__abide-app` immediately), then `{kind:"patch", id, html}` per deferred subtree as it
// resolves (the client fills the `<abide-slot>` — a `fetch`ed body's inline scripts don't run, so it
// applies patches in JS via the same DOM op the first-load move-script does), then `{kind:"seed", seed}`
// last (collected AFTER the drain so streamed reads are included). The client replays the seed and
// hydrates/claims the fully-assembled DOM once the stream ends (`ui/navigate.ts`). Runs the drain +
// `collectSeed` in the captured request context so they read the same request cache.
export function streamSoftNav(shell: string, ctx: CacheContext, config: AppConfig, urlPath: string): ReadableStream<Uint8Array> {
  const stream = ctx.stream;
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const frame = (obj: unknown): void => controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
      frame({ kind: "shell", html: shell, url: urlPath });
      try {
        if (stream !== undefined && (stream.deferred.length > 0 || stream.streamers.length > 0)) {
          await runInContext(ctx, async () => {
            for await (const patch of drainPatches(stream)) {
              if (patch.op === "complete") frame({ kind: "complete", id: patch.id });
              else frame({ kind: patch.op, id: patch.id, html: patch.html }); // "fill" | "append"
            }
          });
        }
      } catch (caught) {
        console.error("[abide] streaming soft-nav drain failed:", caught);
      }
      const seed = runInContext(ctx, () => collectSeed(config));
      frame({ kind: "seed", seed });
      controller.close();
      ctx.stream = undefined;
    },
  });
}
