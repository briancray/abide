// Preload for DOM tests: registers happy-dom's `document`/`window`/`Element`/… as globals so
// client-render tests can mount into a real DOM. happy-dom also clobbers a set of platform globals
// (Response, Request, fetch, WebSocket, …) with its own implementations, which breaks Bun's native
// server tests (instanceof checks, real fetch). We snapshot those native globals first and restore
// them after registration, keeping only the DOM surface from happy-dom.

import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Platform globals that must stay Bun-native (not happy-dom's shims).
const PRESERVE = [
  "fetch",
  "Response",
  "Request",
  "Headers",
  "WebSocket",
  "FormData",
  "Blob",
  "File",
  "URL",
  "URLSearchParams",
  "TextEncoder",
  "TextDecoder",
  "ReadableStream",
  "WritableStream",
  "TransformStream",
  "AbortController",
  "AbortSignal",
  "crypto",
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "queueMicrotask",
  "setImmediate",
  "Promise",
  "performance",
] as const;

const native: Record<string, unknown> = {};
for (const name of PRESERVE) native[name] = (globalThis as Record<string, unknown>)[name];

GlobalRegistrator.register();

for (const name of PRESERVE) {
  if (native[name] !== undefined) (globalThis as Record<string, unknown>)[name] = native[name];
}

// Remove the global `window` so isomorphic side-detection (e.g. cache context) still treats the
// process as a server — the DOM classes keep an internal window reference, so `document` and node
// construction still work without a global `window`. Tests that need a DOM use `document` directly.
delete (globalThis as { window?: unknown }).window;
