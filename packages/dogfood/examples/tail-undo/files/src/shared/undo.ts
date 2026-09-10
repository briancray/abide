import type { Reactive } from 'abide'

// AN UNDO IS ITSELF A WRITE, so it appends to the same ring. Walk
// backwards over the live ring and the second step reads the first
// one back — so the position lives out here, over a snapshot.
export function undoStack<T>(value: Reactive<T>) {
    let history: T[] = []
    let at = 0
    let handed: T | undefined

    return {
        back: (): T => {
            // A write that was not ours ends the run and retakes it.
            if (value.peek() !== handed) {
                history = [...value.tail(50)]
                at = history.length - 1
            }
            if (at > 0) at -= 1
            handed = history[at] as T
            return handed
        },
    }
}
