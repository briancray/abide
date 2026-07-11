/* The per-request SSR render context, threaded through a layout chain and every
   child component a page inlines. It is the block-id counter MAP (ADR-0037): each
   `await`/`try` block draws a path-namespaced id via `blockId(ctx)` — keyed by the
   ambient render-path, counting 0,1,2… in document order WITHIN each path. Both sides
   compose the same ids (the client mounts each child under the same path), so the
   streamed fragments and the `RESUME` manifest line up. Request-local (not a module
   global) because SSR render is async and concurrent — but sibling child renders write
   different path keys, so the shared map needs no locking and survives parallel renders
   (which a single flat counter could not). */
export type RenderContext = Map<string, number>
