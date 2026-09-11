// THE HAND-WRITTEN ARM every reactive ratio is against — `REACTIVE.md`'s phase 0, and
// the reason this lane has no abide in its graph: the arm and the framework have to
// be timed by the same clock and the same batch sizing, and a shared import would
// make the comparison a measurement of one arm against itself.
//
// `let value; const subscribers = []`, and nothing else. It is deliberately not a
// small reactive library: the moment it grows a dependency graph it stops being the
// floor the machinery is budgeted against.
export function signal<Value>(initial: Value): {
    read(): Value
    write(next: Value): void
    subscribe(reader: (value: Value) => void): () => void
} {
    let value = initial
    const subscribers: ((value: Value) => void)[] = []
    return {
        read(): Value {
            return value
        },
        write(next: Value): void {
            // The identity check the framework has to beat. A freshly built wrapper
            // defeats it, which is the whole of CLAUDE.md's first reactive invariant.
            if (next === value) return
            value = next
            for (let index = 0; index < subscribers.length; index += 1)
                (subscribers[index] as (value: Value) => void)(value)
        },
        subscribe(reader: (value: Value) => void): () => void {
            subscribers.push(reader)
            return (): void => {
                const at = subscribers.indexOf(reader)
                if (at >= 0) subscribers.splice(at, 1)
            }
        },
    }
}
