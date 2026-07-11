import { pendingAsyncCellsSlot } from '../shared/pendingAsyncCellsSlot.ts'
import type { PendingAsyncCells } from '../shared/types/PendingAsyncCells.ts'
import { cellBarrierBacking } from './runtime/cellBarrierBacking.ts'

/*
The async-cell barrier list a registration (`createAsyncCell`) or a drain (`settleAsyncCells`) should
use RIGHT NOW: a per-render isolated list if one is active (a hoisted concurrent child render — see
`isolateCellBarrier`), else the per-request list from `pendingAsyncCellsSlot`. The single seam both
barrier consumers read, so an isolated render can't leak its in-flight cells into a sibling's or the
page's drain. Undefined only when neither a render override nor a request/fallback list is installed.
*/
export function activePendingCells(): PendingAsyncCells | undefined {
    return cellBarrierBacking.active.current() ?? pendingAsyncCellsSlot.get()
}
