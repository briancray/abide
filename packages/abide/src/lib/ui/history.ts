import { PATCH_BUS } from './runtime/PATCH_BUS.ts'
import type { Doc } from './runtime/types/Doc.ts'
import type { Patch } from './runtime/types/Patch.ts'
import type { History } from './types/History.ts'

/*
Undo/redo for a document. Subscribes the `PATCH_BUS`, filters to this `doc`, and
journals each applied patch's `inverse` into a bounded stack — O(size of the
change) per step, never a tree snapshot. `undo`/`redo` replay inverses through
`doc.apply`; the patches that replay itself emits are routed into a `sink` so a
replay never opens a fresh entry nor clears the opposite stack (it instead fills
it, keeping the move reversible). A genuine new edit clears the redo stack.
`transaction(fn)` groups every patch `fn` emits into one entry. `limit` caps
depth — the oldest entry drops. Inert (but harmless) on the server.
*/
// @documentation plumbing
export function history(doc: Doc, { limit = 100 }: { limit?: number } = {}): History {
    const undoStack: Patch[][] = []
    const redoStack: Patch[][] = []
    /* When set, captured inverses accumulate here instead of opening a new undo entry
       — held by an in-progress transaction and by an undo/redo replay. */
    let sink: Patch[] | undefined

    /* Push one finished entry, evicting the oldest past `limit`. */
    const push = (stack: Patch[][], entry: Patch[]): void => {
        stack.push(entry)
        if (stack.length > limit) {
            stack.shift()
        }
    }

    const unsubscribe = PATCH_BUS.subscribe((event) => {
        if (event.doc !== doc || event.inverse === undefined) {
            return
        }
        if (sink !== undefined) {
            sink.push(event.inverse)
            return
        }
        push(undoStack, [event.inverse])
        redoStack.length = 0
    })

    /* Apply an entry's inverses in reverse application order (LIFO), capturing the
       inverses they emit — the original forward patches — onto `target`, so the move
       is itself reversible and lands on the opposite stack. */
    const replay = (entry: Patch[], target: Patch[][]): void => {
        const captured: Patch[] = []
        sink = captured
        try {
            for (let index = entry.length - 1; index >= 0; index -= 1) {
                doc.apply(entry[index] as Patch)
            }
        } finally {
            sink = undefined
            /* Push captured inverses even if `apply` threw mid-loop: the already-popped
               entry is gone, so the forward patches for what DID apply must land on the
               opposite stack or a partial replay becomes irreversible. */
            if (captured.length > 0) {
                push(target, captured)
            }
        }
    }

    return {
        undo: () => {
            const entry = undoStack.pop()
            if (entry !== undefined) {
                replay(entry, redoStack)
            }
        },
        redo: () => {
            const entry = redoStack.pop()
            if (entry !== undefined) {
                replay(entry, undoStack)
            }
        },
        canUndo: () => undoStack.length > 0,
        canRedo: () => redoStack.length > 0,
        transaction: (run: () => void) => {
            /* A nested transaction folds into the one already collecting. */
            if (sink !== undefined) {
                run()
                return
            }
            const entry: Patch[] = []
            sink = entry
            try {
                run()
            } finally {
                sink = undefined
                /* Commit whatever was applied even if `run` threw partway: those patches are
                   already live in the doc, so their inverses must reach the undo stack or the
                   committed changes are left with no way to undo them. The throw still
                   propagates after this. */
                if (entry.length > 0) {
                    push(undoStack, entry)
                    redoStack.length = 0
                }
            }
        },
        dispose: () => {
            unsubscribe()
            undoStack.length = 0
            redoStack.length = 0
        },
    }
}
