// SYNCHRONOUS SETTLED-VALUE HINT for the Promise-read model (rpc-core §5 hydration).
//
// Under the Promise-read model the bare cell/RPC call returns `Promise<T>` even when the slot is
// ALREADY settled (seed-primed by SSR). Attach-hydration must CLAIM the server-rendered `{#await
// fn()}` then-branch synchronously — but a promise's resolved value can't be read synchronously. So a
// coalesced load that resolves from an already-settled slot tags its promise with this hint, letting
// the client (`claimAwait`) adopt the server DOM instead of re-mounting. Runtime-only marker (a
// symbol property); the public type stays a clean `Promise<T>`. A genuinely-pending / non-cell promise
// carries no hint and correctly falls back to create-mount.

const SETTLED: unique symbol = Symbol.for("abide.settledRead");

interface Settled {
  value: unknown;
}

// Tag an already-resolved coalesced-load promise with its synchronous value, then return it unchanged.
// Non-enumerable so the marker never rides along in an object spread of the promise.
export function markSettled<T>(promise: Promise<T>, value: T): Promise<T> {
  Object.defineProperty(promise, SETTLED, { value: { value } as Settled, enumerable: false, configurable: true });
  return promise;
}

// The synchronous settled value of a hinted promise, or undefined (real pending / not a promise).
export function peekSettled(candidate: unknown): Settled | undefined {
  if (candidate !== null && (typeof candidate === "object" || typeof candidate === "function") && SETTLED in (candidate as object)) {
    return (candidate as Record<symbol, Settled>)[SETTLED];
  }
  return undefined;
}
