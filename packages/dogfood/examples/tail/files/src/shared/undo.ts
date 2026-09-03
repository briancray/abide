import type { Reactive } from 'abide'

// An undo is ITSELF A WRITE, so it appends to the same ring — walk
// backwards through a ring you are also appending to and the second
// step reads the first one back. So the position lives OUTSIDE the
// value: snapshot the history when a run begins, and move an index
// over that array.
export function undoStack<T>(value: Reactive<T>) {
    const history = [...value.tail()]
    let at = history.length - 1
    return {
        undo() {
            if (at === 0) return
            at -= 1
            value.set(history[at])
        },
        redo() {
            if (at === history.length - 1) return
            at += 1
            value.set(history[at])
        },
    }
}
