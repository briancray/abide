// The "what kind of thing is this?" probes both lanes ask of every value they handle — and, for the
// same reason and at the same cost, the one that asks what a thrown value SAID.
//
// A leaf on purpose: it imports nothing, so the server's emit path and the reactive graph can both
// have it without the emit path pulling in reactivity. One implementation because the two lanes have
// to AGREE — a server that awaits something the client renders as text is a hydration mismatch.
//
// The typeof guard is not defensive spelling, it is the whole cost. `value?.then` on a PRIMITIVE
// boxes it and walks a wrapper prototype: 31 ns on a number in JSC against 1 ns once the guard
// short-circuits. Every write, every slot value and every "is this settled?" probe runs this, so on
// `state.set` alone it is the difference between 44 ns and 14 ns — a hand-written store's 15 ns.

/**
 * What a thrown value SAID, with Bun's aggregate unwrapped.
 *
 * A transpile or a resolution failure out of `import()` arrives as `{ errors: [{ message }] }`, and
 * the wrapper's own message is a generic sentence about a module having failed. The first inner
 * message is the diagnostic — the line and the reason — so reading the wrapper is the difference
 * between "app.ts did not load" and being told which token was unexpected.
 *
 * `instanceof` is not the last word either: a value that crossed a wire can arrive as a plain record
 * carrying a `message`, and `String` on one of those is `[object Object]` — the same reason `isError`
 * matches on the NAME rather than the class.
 */
export function messageOf(failure: unknown): string {
    // Guarded, because `throw null` is legal and a property read off it is a second failure thrown
    // from the code reporting the first.
    if (failure !== null && typeof failure === 'object') {
        const first = (failure as { errors?: { message?: unknown }[] }).errors?.[0]?.message
        if (typeof first === 'string') return first
    }
    if (failure instanceof Error) return failure.message
    const carried = (failure as { message?: unknown } | null | undefined)?.message
    return typeof carried === 'string' ? carried : String(failure)
}

export function isThenable(value: unknown): value is PromiseLike<unknown> {
    if (value === null) return false
    const type = typeof value
    if (type !== 'object' && type !== 'function') return false
    return typeof (value as { then?: unknown }).then === 'function'
}

/**
 * A promise for a value that is USUALLY already settled, without the unconditional wrap.
 *
 * `Promise.resolve` on a thenable is another promise and another microtask tick, and the callers are
 * the two `#shared` documents whose local source answers synchronously in almost every process.
 */
export function settled<T>(value: T | PromiseLike<T>): Promise<T> {
    return (isThenable(value) ? value : Promise.resolve(value)) as Promise<T>
}

export function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
    if (value === null) return false
    const type = typeof value
    if (type !== 'object' && type !== 'function') return false
    return typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function'
}

const HAS_BLOB = typeof Blob !== 'undefined'

/**
 * `Blob`, which `File` extends — the one value in a call that is not JSON.
 *
 * One implementation because three paths decide the SAME thing about it and have to agree: the
 * encoder pulls it out into multipart, the memo key tags it by identity rather than by its (empty)
 * JSON form, and the validator answers `format: 'binary'` with it. One of them learning a new
 * spelling the others do not is a value that is multiparted but not tagged, or tagged but refused.
 */
export function isFile(value: unknown): value is Blob {
    return HAS_BLOB && value instanceof Blob
}

/**
 * Does anything in this graph need the slow encode?
 *
 * A `JSON.stringify` replacer takes the engine OFF its native serializer and calls back once per
 * key, and the calls that carry a file are the rare ones — so the question is asked first and the
 * replacer is passed only when the answer is yes. `for…in` is a superset of what `stringify` walks,
 * so this can over-answer (which costs the general path) and never under-answer.
 */
export function hasFile(value: unknown): boolean {
    if (value === null || typeof value !== 'object') return false
    if (isFile(value)) return true
    if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) if (hasFile(value[i])) return true
        return false
    }
    const held = value as Record<string, unknown>
    for (const name in held) if (hasFile(held[name])) return true
    return false
}

// How deep a `cause` chain is followed. A cap rather than a seen-set: a cycle is the only thing an
// unbounded walk has to fear, and eight links is already further than a wrapped error ever nests.
const CAUSE_DEPTH = 8

/**
 * Is `error` the one named `name` — directly, or wrapped as the `cause` of something else?
 *
 * The NAME rather than the class, because the question outlives the constructor: an error that
 * crossed a wire arrives as a plain object, and `instanceof` on it is false however faithfully it
 * was serialised. Backing `fn.isError` on the shared surface.
 */
export function isNamedError(error: unknown, name: string): boolean {
    let at = error
    for (let depth = 0; depth < CAUSE_DEPTH; depth++) {
        if (at === null || typeof at !== 'object') return false
        if ((at as { name?: unknown }).name === name) return true
        at = (at as { cause?: unknown }).cause
    }
    return false
}
