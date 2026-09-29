/** An undo is itself a write, so the position lives over a snapshot. */
export function undoStack<T>(limit: number) {
    const held: T[] = []
    let run: T[] = []
    let at = 0
    let handed: T | undefined

    return {
        record: (value: T) => {
            held.push(value)
            if (held.length > limit) held.shift()
        },
        back: (current: T): T => {
            // A write that was not ours ends the run and retakes it.
            if (current !== handed) {
                run = held.slice()
                at = run.length - 1
            }
            if (at > 0) at -= 1
            handed = run[at] as T
            return handed
        },
    }
}
