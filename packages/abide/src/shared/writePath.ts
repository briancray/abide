import { putOwn } from './putOwn.ts'

/**
 * A copy of `value` with `next` written at `path`, each level down the path copied.
 *
 * 31.8 — a write through a member path COPIES DOWN THE PATH AND THEN WRITES, and the copy is not
 * optimized away. The copy is the whole point: a `Reactive` wakes its readers on IDENTITY, so
 * `user.name = 'x'` done as a mutation of the held object writes the right value and wakes nobody
 * — the page renders correctly on load and then never moves again, with nothing about it saying
 * so.
 *
 * A HELPER RATHER THAN A SPREAD PER LEVEL IN THE EMITTED CODE, because the compiler cannot tell an
 * array index from an object key: `rows[0] = v` emitted as `{ ...rows(), 0: v }` hands back an
 * object where an array was, and `length`, `map` and every later `{#for}` over it go with it. The
 * shape is decided here, where the value is.
 *
 * 31.14 — ONLY PLAIN DATA IS COPIED. An element, a class instance, a `Map`: anything whose prototype
 * is not `Object.prototype`, `null` or `Array.prototype` owns its own state, and its setters say
 * what a write means — `video.currentTime = t` seeks. A spread of one is a plain object holding a
 * few own fields, so the write reached nothing and the `Reactive` came to hold the husk. The write
 * lands on the object itself, like a method call on it would (31.6), and the root comes back
 * unchanged, so the `set` it is handed to wakes nobody.
 */
export function writePath(
    value: unknown,
    path: readonly (string | number)[],
    next: unknown,
): unknown {
    if (path.length === 0) return next
    let owner = value
    for (let at = 0; at < path.length; at += 1) {
        if (!isPlain(owner)) {
            writeThrough(owner as Level, path, at, next)
            return value
        }
        if (at < path.length - 1)
            owner = (owner as Level | null | undefined)?.[
                path[at] as string | number
            ]
    }
    const root = copyOf(value, path[0] as string | number)
    let level = root
    for (let at = 0; at < path.length - 1; at += 1) {
        const step = path[at] as string | number
        const child = copyOf(level[step], path[at + 1] as string | number)
        putOwn(level, step, child)
        level = child
    }
    putOwn(level, path[path.length - 1] as string | number, next)
    return root
}

// Plain data: what a copy reproduces whole. An absent level is plain — the copy builds it fresh.
function isPlain(value: unknown): boolean {
    if (value === null || typeof value !== 'object') return true
    const prototype = Object.getPrototypeOf(value)
    return (
        prototype === Object.prototype ||
        prototype === null ||
        Array.isArray(value)
    )
}

// The rest of the path walked on the live objects from `from`, and the last step assigned there.
function writeThrough(
    owner: Level,
    path: readonly (string | number)[],
    from: number,
    next: unknown,
): void {
    let level = owner
    for (let at = from; at < path.length - 1; at += 1)
        level = level[path[at] as string | number] as Level
    level[path[path.length - 1] as string | number] = next
}

// One level of the copy, written by either kind of step. An array indexes by number and an object
// by string, and no TypeScript shape is both — which is what the one cast below stands for.
type Level = Record<string | number, unknown>

// An ARRAY STAYS AN ARRAY and everything else becomes a plain object. A spread of `null` or
// `undefined` is an empty object rather than a throw, so a write through a path an intermediate
// level never held lands in a fresh object instead of taking the page down.
//
// AN ABSENT LEVEL IS BUILT FROM THE STEP THAT WILL INDEX IT, because nothing else knows: `{}` for
// every miss made `data.rows[0] = v` over a `{rows: undefined}` state answer `{rows: {0: v}}` —
// an object where an array was, with `length`, `map` and every later `{#for}` over it gone, which
// is verbatim the failure `writePath`'s docstring says this helper exists to prevent. The step
// already says which shape was meant.
function copyOf(value: unknown, step: string | number): Level {
    if (Array.isArray(value)) return value.slice() as unknown as Level
    if (value === null || value === undefined)
        return (typeof step === 'number' ? [] : {}) as unknown as Level
    return { ...(value as object) }
}

/**
 * What `mutate` hands back, called on a copy of the array at `path` that `target` then holds.
 *
 * 31.9 — A MUTATOR IS A WRITE THROUGH ITS RECEIVER'S PATH. `tags.push(t)` run on the held array
 * grows it in place, so the identity a reader wakes on never moves (31.8's failure, spelled as a
 * call). The compiler lifts a call here only where the receiver's TYPE is an array, so a class's
 * own `push` stays a call on the class. A level that is not plain data on the way (31.14), or a
 * receiver that is not an array when the call runs, takes the call in place, waking nobody.
 */
export function mutatePath<Result>(
    target: { (): unknown; set(value: unknown): unknown },
    path: readonly (string | number)[],
    mutate: (receiver: never) => Result,
): Result {
    const value = target()
    let receiver = value
    let plain = true
    for (const step of path) {
        plain &&= isPlain(receiver)
        receiver = (receiver as Level | null | undefined)?.[step]
    }
    if (!plain) return mutate(receiver as never)
    if (!Array.isArray(receiver)) return mutate(receiver as never)
    const copy = receiver.slice()
    const result = mutate(copy as never)
    target.set(writePath(value, path, copy))
    return result
}
