// done(iterable) — a reactive boolean: has this async iterable finished streaming? Pair it with a
// `{#for await}` over the SAME iterable object (create the stream once and reuse it): the runtime
// flips this true when the stream ends (or throws). It is true on the server only if the stream
// completed within the single SSR pass; otherwise it becomes true reactively on the client once the
// stream drains. Isomorphic — safe to call in a `.abide` template (imported via `abide/shared/done`).

import { iterableDone } from "./internal/iterableDone.ts";

export function done(iterable: unknown): boolean {
  return iterableDone(iterable);
}
