/* The per-request SSR render context, threaded through a layout chain and every
   child component a page inlines. `next` is the block-id counter: each `await`/`try`
   block draws from it in depth-first document order — the SAME order the client
   allocates ids during its synchronous hydration walk, so the streamed fragments and
   the `RESUME` manifest line up. Request-local (not a module global) because SSR
   render is async — a blocking `await` yields, and a shared global counter would
   interleave across concurrent requests. */
export type RenderContext = { next: number }
