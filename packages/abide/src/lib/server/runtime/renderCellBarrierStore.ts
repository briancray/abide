// AsyncLocalStorage is canonical via node:async_hooks — Bun has no separate API
import { AsyncLocalStorage } from 'node:async_hooks'
import type { PendingAsyncCells } from '../../shared/types/PendingAsyncCells.ts'

/*
The server's per-RENDER async-cell barrier store (ADR-0037 Phase 2). Backs `cellBarrierBacking` with
a fresh pending-cells list pushed by `isolateCellBarrier` around a hoisted concurrent child render.
Unlike the per-request `pendingAsyncCells` (one list a whole request shares), `run`'s value is
inherited by the child render's own async continuations — so a child that suspends on its script
await or its `$$settleAsyncCells` barrier keeps reading ITS list, and two sibling renders in flight
at once never splice each other's cells. `getStore()` is `undefined` outside any isolated render, so
the page's own cells fall through to the request list. Server-only, kept out of `lib/ui` so the
browser bundle never drags in `node:async_hooks`. Mirrors `pathStore` (ADR-0033 D1).
*/
export const renderCellBarrierStore = new AsyncLocalStorage<PendingAsyncCells>()
