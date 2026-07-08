import { isAsyncCell } from '../../shared/isAsyncCell.ts'

/*
Unified read for a `computed`/`linked` reference the compiler lowers to `$$readCell(NAME)`:
an async cell (`AsyncComputed`/`AsyncState`) yields its latest retained value via `peek()`,
a `derive` reader (a function) is called, and a sync `Computed`/`State` yields its `.value`.
One read shape lets a `linked`/`computed` binding auto-track whichever source it resolved to
— a settling promise, a stream, or a plain value — with no read-site branching in codegen.
*/
// @documentation plumbing
export function readCell(cell: unknown): unknown {
    if (isAsyncCell(cell)) {
        return (cell as { peek(): unknown }).peek()
    }
    if (typeof cell === 'function') {
        return (cell as () => unknown)()
    }
    return (cell as { value: unknown }).value
}
