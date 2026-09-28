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
//
// A RAW OBJECT THE CALLBACK PLACES IN THE VALUE IS WRITTEN THROUGH NO PROXY, since the callback
// holds it directly: `list.push(row); row.name = x`. So a placed object is SENT AS IT STANDS WHEN THE
// CALLBACK RETURNS — every op's value is copied then rather than at its write — and a write made
// under one is not kept, since that copy already carries it.
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
// value is stored as that object (`stored`) — a read any other object answers with `undefined`.
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
    // 18.26 — where each object was reached from the root: a path read before its array was
    // reshaped may no longer name the same object.
    const paths = sink === undefined ? undefined : new Map<object, Step>()
    // Every raw object `stored` has walked: what a placed object is — one reached under it is sent in
    // its copy — and what stops the walk on a value inside itself.
    let walked: Set<object> | undefined

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

    // 18.26 — the path a write through `held` is kept at: `undefined` where it cannot be trusted, and
    // `null` where it need not be kept because an object on it was PLACED, and is sent as it stands.
    // A PATH IS TRUSTED WHERE EACH STEP STILL NAMES WHAT IT WAS REACHED BY, asked of the value as it
    // stands at the write — which is when the replay applies it. A reshape, an assignment, a
    // `delete` or a shortened `length` that moved an object off its slot all fail the same read,
    // and an array's own path is untouched by its reshape, so two pushes to one nested list are
    // both kept. The keys are gathered by the same walk, after `last` — the step a write names
    // below `held`, where it names one.
    const pathTo = (
        held: object,
        last: string | number | undefined,
    ): (string | number)[] | null | undefined => {
        let step = paths?.get(held)
        if (step === undefined) return undefined
        const path: (string | number)[] = last === undefined ? [] : [last]
        let child = held
        for (; step.parent !== null; step = step.above as Step) {
            if (step.placed) return null
            if (Reflect.get(step.parent, step.key) !== child) return undefined
            path.push(step.key)
            child = step.parent
        }
        return path.reverse()
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

    // A WRITE UNDER A PLACED OBJECT IS NOT KEPT: the copy of it sent is taken after the write.
    const keep = (
        held: object,
        last: string | number | undefined,
        op: (path: (string | number)[]) => PatchOp,
    ): void => {
        if (sink === undefined || sink.lost) return
        const path = pathTo(held, last)
        if (path === null) return
        if (path === undefined) sink.lost = true
        else sink.ops.push(op(path))
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
                    const raws = args.map(stored)
                    if (sink !== undefined) {
                        if (args.some((arg) => typeof arg === 'function'))
                            sink.lost = true
                        else
                            keep(held, undefined, (path) => ({
                                path,
                                call: property,
                                args: raws,
                            }))
                    }
                    const result = (
                        value as (...args: unknown[]) => unknown
                    ).apply(held, raws)
                    // `sort`, `reverse`, `fill` and `copyWithin` answer the array itself, and
                    // handing back the raw one would take every write after it off the record.
                    return result === held
                        ? (reached.get(held) as Reached).proxy
                        : result
                }
            if (value === null || typeof value !== 'object') return value
            const entry = reach(value, held)
            if (paths !== undefined && !paths.has(value)) {
                const above = paths.get(held)
                if (above !== undefined)
                    paths.set(
                        value,
                        new Step(
                            stepOf(held, property),
                            held,
                            above,
                            walked?.has(value) ?? false,
                        ),
                    )
            }
            if (entry.proxy !== null) return entry.proxy
            mark(value)
            // Reached, and outside what a proxy can watch: whatever it does next is not kept.
            if (sink !== undefined) sink.lost = true
            return value
        },
        set(held, property, value) {
            mark(held)
            const raw = stored(value)
            if (sink !== undefined) {
                keep(held, stepOf(held, property), (path) => ({
                    path,
                    set: raw,
                }))
            }
            return Reflect.set(held, property, raw, held)
        },
        deleteProperty(held, property) {
            mark(held)
            if (sink !== undefined)
                keep(held, stepOf(held, property), (path) => ({
                    path,
                    delete: true,
                }))
            return Reflect.deleteProperty(held, property)
        },
    }

    // WHAT A WRITE PUTS IN THE VALUE, WITH NO PROXY ANYWHERE IN IT. A proxy stored would outlive the
    // patch and go on marking writes, and a new array built from proxied reads — a `filter`, a
    // spread row — holds them below its top.
    //
    // AN OBJECT IN TWO PLACES IS NOT REFUSED: every op's copy is taken when the callback returns, so
    // each place is sent as it then stands, and a write kept through either path replays onto the
    // copy at that path as it did on the server. What the wire cannot carry is the one object two
    // places share, and a value sent whole loses that the same way.
    const stored = (value: unknown): unknown => {
        if (value === null || typeof value !== 'object') return value
        const target = (value as { [TARGET]?: object })[TARGET]
        if (target !== undefined) return target
        if (!isWrappable(value)) return value
        walked ??= new Set()
        if (walked.has(value)) return value
        walked.add(value)
        // Handed back raw by a reshape — a row `pop` took out — and put back: placed, so sent as it
        // stands, with no proxy below it and no write under it kept.
        const step = paths?.get(value)
        if (step !== undefined) step.placed = true
        if (reached.has(value)) return value
        if (Array.isArray(value)) {
            for (let index = 0; index < value.length; index += 1) {
                const field: unknown = value[index]
                if (field === null || typeof field !== 'object') continue
                const inner = stored(field)
                if (inner !== field) value[index] = inner
            }
            return value
        }
        const fields = value as Record<string, unknown>
        for (const key in fields) {
            const field = fields[key]
            if (field === null || typeof field !== 'object') continue
            const inner = stored(field)
            if (inner !== field) fields[key] = inner
        }
        return value
    }

    const proxy = new Proxy(root, handler)
    reached.set(root, new Reached(proxy, null))
    paths?.set(root, new Step('', null, null, false))
    const first = sink === undefined ? 0 : sink.ops.length
    try {
        mutate(proxy as Value)
    } finally {
        // SENT AS THEY STAND NOW: the ops hold the objects they stored, and a write made after
        // one — raw or under a placed object — is in its copy rather than an op of its own.
        if (sink !== undefined && !sink.lost)
            try {
                for (let index = first; index < sink.ops.length; index += 1) {
                    const op = sink.ops[index] as PatchOp
                    if ('set' in op) op.set = snapshot(op.set)
                    else if ('call' in op)
                        op.args = snapshot(op.args) as unknown[]
                }
            } catch {
                // A value `structuredClone` refuses — a function in a row — is sent whole instead.
                sink.lost = true
            }
    }
}

const snapshot = (raw: unknown): unknown =>
    raw !== null && typeof raw === 'object' ? structuredClone(raw) : raw

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

// 18.26 — the key an object was reached by, the object it was read off — `null` for the root — and
// that object's own step, and whether the callback placed it.
class Step {
    key: string | number
    parent: object | null
    above: Step | null
    placed: boolean
    constructor(
        key: string | number,
        parent: object | null,
        above: Step | null,
        placed: boolean,
    ) {
        this.key = key
        this.parent = parent
        this.above = above
        this.placed = placed
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
