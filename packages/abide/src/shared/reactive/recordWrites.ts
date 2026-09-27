// 32.34 — THE CALLBACK AN `s.patch` IS HANDED WRITES THROUGH A PROXY, so what it wrote to is known
// without a copy of the value to diff against. A write marks the object written AND every object on
// the path down to it: a row reads its item, and `row.address.city = x` changed what that row shows
// without touching the row's own object.
//
// ONLY ARRAYS AND PLAIN OBJECTS ARE WRAPPED. A `Map`, a `Set` or a class instance keeps internal
// slots a proxy cannot stand in for — `Map.prototype.set` refuses a proxy as its receiver — so one
// reached is marked written the moment it is read, path and all. That over-reports, and an
// over-report costs a row remade where an under-report shows a stale one.
//
// 18.26 — AND WHERE A SINK IS HANDED IN, each write is kept as data too: a set, a delete, or an array
// method called with its arguments, at the path it was reached by. Anything that cannot be replayed
// from that — a comparator, a `Map`'s own method, a row reached before its array was reordered —
// marks the sink `lost` rather than send something that would land somewhere else (18.28).
import type { PatchOp } from './PATCH_SINKS.ts'
import { PATCHES } from './PATCHES.ts'

// The array methods that change the array they are called on. Kept as ONE call rather than the index
// writes it makes, which for a `splice` near the front is a write per element after it.
const RESHAPING = new Set([
    'push',
    'pop',
    'shift',
    'unshift',
    'splice',
    'sort',
    'reverse',
    'fill',
    'copyWithin',
])

// What a proxy of this module answers with the object it stands for, so one handed back into the
// value is stored as that object (`unwrapped`) — a read any other object answers with `undefined`.
const TARGET = Symbol('target')

export function recordWrites<Value>(
    root: Value,
    mutate: (value: Value) => void,
    sink?: { ops: PatchOp[]; lost: boolean },
): void {
    if (!isWrappable(root)) {
        mutate(root)
        return
    }
    PATCHES.epoch += 1
    const epoch = PATCHES.epoch
    const written = PATCHES.written
    // EVERY OBJECT THE PATCH REACHED, by what it is: the one proxy it is handed out as, so
    // `list[0] === list[0]` inside the callback, and its parent. ONE ENTRY rather than a map for each,
    // because a row read is the loop this runs per row and each map is a lookup and an insert there.
    const reached = new Map<object, Reached>()
    // 18.26 — where each object was first reached from the root, and how many reshapes had happened
    // when it was: a path read before a reshape may no longer name the same object.
    const paths =
        sink === undefined
            ? undefined
            : new Map<object, { path: (string | number)[]; at: number }>()
    let reshapes = 0

    // STOPS AT AN OBJECT ALREADY MARKED IN THIS PATCH, since everything above it was marked with it —
    // so a loop writing every row marks the array once rather than once a row.
    const mark = (held: object | null): void => {
        if (held === null) return
        // Everything marked was reached first: a target, a parent of one, or a value read.
        const entry = reached.get(held) as Reached
        if (entry.marked) return
        entry.marked = true
        written.set(held, epoch)
        const above = entry.parent
        if (above instanceof Parents) for (const one of above.all) mark(one)
        else mark(above)
    }

    // THE PATH IS A PARENT POINTER, walked up at a write rather than copied down at every read. AN
    // OBJECT REACHED TWICE HOLDS BOTH PARENTS — one shared by two rows is on both their paths, and
    // marking only the first would leave the second showing what the patch replaced.
    const reach = (value: object, parent: object): Reached => {
        const known = reached.get(value)
        // First reached: nothing below the root is written before it is reached, so there is no
        // write here for the new parent to be marked by.
        if (known === undefined) {
            const proxy = isWrappable(value) ? new Proxy(value, handler) : null
            const entry = new Reached(proxy, parent)
            reached.set(value, entry)
            return entry
        }
        const above = known.parent
        if (above === parent || above === null) return known
        if (above instanceof Parents) {
            if (above.all.includes(parent)) return known
            above.all.push(parent)
        } else known.parent = new Parents([above, parent])
        // A parent found after the write is above it all the same, and the early stop in `mark`
        // would never climb to it.
        if (known.marked) mark(parent)
        return known
    }

    // 18.26 — the path a write through `held` is kept at, or `undefined` where it cannot be trusted.
    const pathTo = (held: object): (string | number)[] | undefined => {
        const known = paths?.get(held)
        if (known === undefined) return undefined
        if (known.at !== reshapes && known.path.length > 0) return undefined
        return known.path
    }

    // Only an INDEX is a number: `length` on an array is a named step, and `Number('length')` is NaN.
    const stepOf = (
        held: object,
        property: string | symbol,
    ): string | number =>
        Array.isArray(held) &&
        typeof property === 'string' &&
        String(Number(property)) === property
            ? Number(property)
            : String(property)

    const keep = (
        held: object,
        op: (path: (string | number)[]) => PatchOp,
    ): void => {
        if (sink === undefined || sink.lost) return
        const path = pathTo(held)
        if (path === undefined) sink.lost = true
        else
            try {
                sink.ops.push(op(path))
            } catch {
                // A value `structuredClone` refuses — a function in a row — is sent whole instead.
                sink.lost = true
            }
    }

    const handler: ProxyHandler<object> = {
        get(held, property) {
            if (property === TARGET) return held
            const value = Reflect.get(held, property, held)
            if (
                typeof value === 'function' &&
                Array.isArray(held) &&
                typeof property === 'string' &&
                RESHAPING.has(property)
            )
                return (...args: unknown[]) => {
                    mark(held)
                    if (sink !== undefined)
                        if (args.some((arg) => typeof arg === 'function'))
                            sink.lost = true
                        else
                            keep(held, (path) => ({
                                path,
                                call: property,
                                args: args.map(snapshot),
                            }))
                    reshapes += 1
                    return (value as (...args: unknown[]) => unknown).apply(
                        held,
                        args.map(unwrapped),
                    )
                }
            if (value === null || typeof value !== 'object') return value
            const entry = reach(value, held)
            if (paths !== undefined && !paths.has(value)) {
                const above = paths.get(held)
                // A CHILD IS AS STALE AS ITS PARENT: one reached after a reshape through a row read
                // before it hangs off an index that may have moved. The root's own path cannot.
                if (above !== undefined)
                    paths.set(value, {
                        path: [...above.path, stepOf(held, property)],
                        at: above.path.length === 0 ? reshapes : above.at,
                    })
            }
            if (entry.proxy !== null) return entry.proxy
            mark(value)
            // Reached, and outside what a proxy can watch: whatever it does next is not kept.
            if (sink !== undefined) sink.lost = true
            return value
        },
        set(held, property, value) {
            mark(held)
            if (sink !== undefined)
                keep(held, (path) => ({
                    path: [...path, stepOf(held, property)],
                    set: snapshot(value),
                }))
            return Reflect.set(held, property, unwrapped(value), held)
        },
        deleteProperty(held, property) {
            mark(held)
            if (sink !== undefined)
                keep(held, (path) => ({
                    path: [...path, stepOf(held, property)],
                    delete: true,
                }))
            return Reflect.deleteProperty(held, property)
        },
    }

    // A proxy stored back into the value would outlive the patch and go on marking writes.
    const unwrapped = (value: unknown): unknown =>
        value !== null && typeof value === 'object'
            ? ((value as { [TARGET]?: object })[TARGET] ?? value)
            : value

    // TAKEN AT THE WRITE, not when the ops are sent: `list.push(row); row.name = x` would otherwise
    // send a row already named, and then name it again.
    const snapshot = (value: unknown): unknown => {
        const raw = unwrapped(value)
        return raw !== null && typeof raw === 'object'
            ? structuredClone(raw)
            : raw
    }

    const proxy = new Proxy(root, handler)
    reached.set(root, new Reached(proxy, null))
    paths?.set(root, { path: [], at: 0 })
    mutate(proxy as Value)
}

// An object the patch reached: the proxy it is handed out as — `null` for one no proxy can stand in
// for — and what it was reached from, `null` for the root.
class Reached {
    proxy: object | null
    parent: object | Parents | null
    // Written in this patch, directly or below — `PATCHES.written` holds this patch's epoch for it.
    marked: boolean
    constructor(proxy: object | null, parent: object | Parents | null) {
        this.proxy = proxy
        this.parent = parent
        this.marked = false
    }
}

// Every parent of an object the patch reached more than once, and a class so that a parent which is
// itself an array is never read as a list of them.
class Parents {
    all: object[]
    constructor(all: object[]) {
        this.all = all
    }
}

function isWrappable(value: unknown): value is object {
    if (value === null || typeof value !== 'object') return false
    if (Array.isArray(value)) return true
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
}
