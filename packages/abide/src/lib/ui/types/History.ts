/*
The undo/redo handle returned by `history(doc)`. `undo`/`redo` step the journal
of inverse patches; `canUndo`/`canRedo` report availability; `transaction` groups
a burst of patches into one reversible step (one user action = one undo); `dispose`
detaches from the `PATCH_BUS` and drops the journal.
*/
export type History = {
    undo: () => void
    redo: () => void
    canUndo: () => boolean
    canRedo: () => boolean
    transaction: (run: () => void) => void
    dispose: () => void
}
