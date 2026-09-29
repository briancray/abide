/**
 * A hand-written signal: a value and a subscriber list, notified on identity change.
 *
 * THE HAND-WRITTEN ARM every reactive ratio is against, and the reason this lane has no abide in
 * its graph: the arm and the framework have to be timed by the same clock and the same batch
 * sizing, and a shared import would make the comparison a measurement of one arm against itself.
 *
 * `let value; const subscribers = []`, and nothing else. It is deliberately not a small reactive
 * library: the moment it grows a dependency graph it stops being the floor the machinery is
 * budgeted against.
 */
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

/**
 * `signal` without the identity check: every write notifies every subscriber.
 *
 * THE SAME ARM WRITTEN CARELESSLY, and the reason both are here: a ratio against the CAREFUL
 * hand-written version prices what abide costs, and a ratio against this one prices what it BUYS.
 * Quoting only the first is quoting the bill with no receipt — the identity check `signal`
 * carries is itself machinery somebody wrote on purpose, and a framework that is 3.6x a
 * hand-written guard is a different claim from one that is 0.4x the code most people actually
 * write.
 *
 * Not a strawman: notifying unconditionally is the obvious first version, it is what a `useState`
 * setter does, and nothing about it looks wrong until a reader counts its own wake-ups. That is
 * the whole of CLAUDE.md's first reactive invariant seen from the other side.
 */
export function carelessSignal<Value>(initial: Value): {
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
            // No identity check. Every write is a wake, whatever was already held.
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
