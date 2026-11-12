// What compiled `.abide` output calls on BOTH sides, and no author writes — none of it has a
// REGISTRY row. Not an entry of its own: `@abide/abide/runtime` (`ui/index.ts`) and
// `@abide/abide/server/runtime` (`server/runtime.ts`) each re-export it whole, so the list is
// stated once and the two lanes cannot disagree about which run-time half a name has.

// 32.37 — what a value writes into an attribute.
export { attributeMarkup, attributeText } from './attributeText.ts'
// 32.5, 32.6, 32.8, 32.61 — what a `bind:` operand holds, as the markup writes it into the tag.
export {
    boundProp,
    boundValue,
    groupHolds,
    selectedMarkup,
} from './boundValue.ts'
// 32.1 — the escaping.
export { escapeAttribute, escapeStyleValue, escapeText } from './escapeText.ts'
// 32.15's run-time half: what a `{#for}` subject iterates as — the server's emitted block, the
// client's `updateList`, and the markup a client builds for a row.
export { listOf } from './listOf.ts'
// 33.6, 33.7, 33.20, 33.22, 33.27 — a prop the child writes, defaults, and one handed where a
// `Reactive` is due.
export {
    heldProp,
    propCell,
    propCells,
    propOr,
    restValues,
    withoutKeys,
} from './propCell.ts'
// 32.2's `raw`, an author's, rides along so an emitted module imports from ONE specifier; 32.30's
// anchored run is the compiler's.
export { markupRun, RAW_WRITES, raw } from './Raw.ts'
// 10.5 — the share scope an emitted component opens for its instance.
export {
    currentShare,
    enterShare,
    leaveShare,
    resumeShare,
} from './reactive/share.ts'
// 32.20 — the url guard.
export { safeUrl } from './safeUrl.ts'
// 34.32 — a setup's read of an unlanded value, named.
export { setupThrown } from './setupThrown.ts'
// 32.23 — a markup position that aborts on an unlanded read.
export { slotValue } from './slotValue.ts'
// 32.11 — a spread, as props and as markup.
export { spreadAttributes, spreadProps } from './spread.ts'
// 31.8, 31.9 — a write through a path, and an array mutator lifted to one.
export { mutatePath, writePath } from './writePath.ts'
