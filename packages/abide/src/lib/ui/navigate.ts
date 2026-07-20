// CLIENT SOFT-NAV (M5b / abide-compiler C6-nav) — SPA navigation without a full document load.
//
// `navigate(path)` pushes a history entry, then fetches `path` with the `Abide-Nav: <currentPath>`
// header. The server STREAMS the destination page as a JSONL frame stream (streaming-ssr-plan.md PR4):
// `{kind:"shell", html, url}` first, then `{kind:"patch", id, html}` per streamed subtree as it
// resolves, then `{kind:"seed", seed}` last. `softLoad` reads the frames progressively — swaps the
// shell into `#__abide-app` immediately (a slow read shows its `<abide-slot>` fallback), fills each
// placeholder slot as its patch frame arrives (in JS — a fetched body's inline scripts don't run), then
// once the stream ends HYDRATES the fully-assembled DOM (claim in place — the SAME path as first load,
// PR3 unwraps the slots). The seed primes the reads so the claim suppresses re-fetch + the initial
// write. Before hydrating it updates the reactive client route so `route()`-dependent bindings re-run.
// A middleware short-circuit still arrives as a JSON `{redirect}` envelope (handled first). Link clicks
// and back/forward drive the same path (see bootstrap.ts).
//
// Deferred: per-route code-splitting (the whole app ships in one bundle) and scroll restoration
// (top-scroll unless `keepScroll`).

import { bootstrapPage } from "./internal/bootstrap.ts";
import { pageBase, pageEntry, pagePatterns, pageSpecs } from "./internal/pageRegistry.ts";
import { matchRoute } from "../server/internal/matchRoute.ts";
import { setClientRoute } from "../shared/internal/routeHolder.ts";
import type { RouteInfo } from "../server/internal/scope.ts";
import type { HydrationSeed } from "../server/internal/pages.ts";

const CONTAINER_ID = "__abide-app";

export interface NavigateOptions {
  // Replace the current history entry instead of pushing a new one.
  replace?: boolean;
  // Keep the current scroll position instead of scrolling to the top on navigation.
  keepScroll?: boolean;
}

// The disposer for the currently mounted page. mountPathname disposes it before mounting the next page.
let activeCleanup: (() => void) | null = null;

// Match a pathname against the registered page patterns, set the reactive client route, dispose the
// previous mount, and mount the destination page. Returns false when no page matches (caller falls
// back to a full load). Used for the initial client mount (no `seed` → the inline seed script is
// used) AND every soft-nav (`seed` = the envelope's hydration payload).
export function mountPathname(pathname: string, seed?: HydrationSeed): boolean {
  const match = matchRoute(pagePatterns(), pathname);
  if (match === null) return false;
  const entry = pageEntry(match.pattern);
  if (entry === undefined) return false;

  const info: RouteInfo = {
    kind: "nav",
    name: match.pattern,
    params: match.params,
    url: new URL(pathname, location.origin),
    navigating: false,
  };

  // Dispose the previous page mount BEFORE updating the reactive route. On a same-route sibling-param
  // nav (`[slug]` alpha → beta) the destination reuses the same page module, so the outgoing mount's
  // effects are still live and STILL subscribed to `route().params`. Publishing the new params first
  // would re-run those doomed effects against the new slug — e.g. a `{#await topic({ slug })}` block
  // would mount a SECOND resolved branch into the just-swapped DOM before it is torn down (duplicate
  // `topic`). Disposing first unsubscribes them so only the freshly-hydrated page reads the new route.
  if (activeCleanup !== null) {
    activeCleanup();
    activeCleanup = null;
  }
  setClientRoute(info);

  // One hydrate path for first load and soft-nav (decision 6): claim the SSR (initial) or the
  // innerHTML-swapped (soft-nav) server DOM in place rather than fresh-mounting over it.
  activeCleanup = bootstrapPage(entry.hydrate, pageSpecs(), pageBase(), seed);
  return true;
}

// Dispose the currently mounted page (unmount its effects). Used by app teardown.
export function disposeActive(): void {
  if (activeCleanup !== null) {
    activeCleanup();
    activeCleanup = null;
  }
}

// Read a JSONL byte stream as parsed frame objects, yielding each as its `\n`-terminated line
// completes — so the caller applies the shell, then each patch, progressively as they arrive.
async function* readFrames(body: ReadableStream<Uint8Array>): AsyncGenerator<Record<string, unknown>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (value !== undefined) buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line.length > 0) yield JSON.parse(line) as Record<string, unknown>;
      newline = buffer.indexOf("\n");
    }
    if (done) break;
  }
  const rest = buffer.trim();
  if (rest.length > 0) yield JSON.parse(rest) as Record<string, unknown>;
}

// Fill a streamed placeholder slot with its patch HTML — the same DOM op the first-load move-script
// does, but from JS (a `fetch`ed body's inline scripts don't auto-run). Hydration later unwraps it.
function fillSlot(id: number, html: string): void {
  const slot = document.getElementById(`ab-p:${id}`);
  if (slot === null) return;
  const template = document.createElement("template");
  template.innerHTML = html;
  slot.replaceChildren(template.content);
}

// Fetch the destination page, apply its streamed frames into the container, and HYDRATE (claim the
// assembled DOM). Shared by navigate() (after a history push) and popstate (no history mutation). A
// non-stream response (a middleware `{redirect}` JSON envelope, a full HTML document, an error), a
// network failure, or an unmatched route falls back so navigation never dead-ends.
async function softLoad(path: string, from: string, opts?: NavigateOptions): Promise<void> {
  const target = new URL(path, location.origin);

  let response: Response;
  try {
    response = await fetch(path, { headers: { "Abide-Nav": from } });
  } catch {
    location.href = path;
    return;
  }

  const contentType = response.headers.get("content-type") ?? "";
  const container = document.getElementById(CONTAINER_ID);

  // Check `jsonl` BEFORE `json` — "application/jsonl" contains "application/json" as a substring, so a
  // naive `.includes("application/json")` would misclassify the frame stream as a redirect envelope.
  const isStream = contentType.includes("application/jsonl");

  // A middleware short-circuit arrives as a JSON `{redirect}` envelope (not the frame stream).
  if (!isStream && contentType.includes("application/json")) {
    let envelope: { redirect?: string };
    try {
      envelope = (await response.json()) as typeof envelope;
    } catch {
      location.href = path;
      return;
    }
    if (typeof envelope.redirect === "string" && envelope.redirect.length > 0) {
      await navigate(envelope.redirect, { replace: true });
      return;
    }
    location.href = path;
    return;
  }

  // Not the streamed soft-nav body (a full HTML document / error page) → real load.
  if (!isStream || response.body === null || container === null) {
    location.href = path;
    return;
  }

  // Dispose the previous page mount BEFORE swapping so its still-live effects don't react to the shell
  // swap / streamed patch fills (the dispose-first invariant — see mountPathname's note). `mountPathname`
  // below then re-disposes harmlessly (already null) and sets the route + hydrates.
  disposeActive();

  let seed: HydrationSeed | undefined;
  let navUrl = target.pathname;
  try {
    for await (const frame of readFrames(response.body)) {
      if (frame.kind === "shell") {
        if (typeof frame.html === "string") container.innerHTML = frame.html;
        if (typeof frame.url === "string") navUrl = frame.url;
      } else if (frame.kind === "patch") {
        if (typeof frame.id === "number" && typeof frame.html === "string") fillSlot(frame.id, frame.html);
      } else if (frame.kind === "seed") {
        seed = frame.seed as HydrationSeed;
      }
    }
  } catch {
    location.href = path;
    return;
  }

  // Hydrate the fully-assembled DOM: replay this stream's recorded reads then claim in place (PR3
  // unwraps any streamed `<abide-slot>`).
  if (!mountPathname(navUrl, seed)) {
    location.href = path;
    return;
  }

  if (opts?.keepScroll !== true && typeof scrollTo === "function") {
    scrollTo(0, 0);
  }
}

// Client-side SPA navigation to `path`. Pushes (or replaces) a history entry, then soft-loads the
// destination. A no-op outside the browser so importing it under SSR is safe.
export async function navigate(path: string, opts?: NavigateOptions): Promise<void> {
  if (typeof document === "undefined") return;
  const from = location.pathname;
  if (opts?.replace === true) history.replaceState(null, "", path);
  else history.pushState(null, "", path);
  await softLoad(path, from, opts);
}

// Whether a pathname matches a known in-app page pattern. Used to decide if a link/history entry is
// abide's to soft-navigate, or a plain browser navigation (e.g. /openapi.json, /rpc/*, static files).
export function isKnownPage(pathname: string): boolean {
  return matchRoute(pagePatterns(), pathname) !== null;
}

// Back/forward: re-load the page at the current location WITHOUT touching history (the browser already
// moved the entry). Registered by bootstrap. keepScroll — the browser restores scroll for popstate.
// If the current entry isn't an in-app page (e.g. the user is arriving back from a non-page URL), let
// the browser own it rather than soft-loading a non-envelope response.
export function handlePopState(): void {
  if (!isKnownPage(location.pathname)) return;
  void softLoad(location.pathname + location.search, location.pathname, { keepScroll: true });
}
