// abide value codec (rpc-core §4/§11).
//
// Two independent jobs:
//   1. canonicalKey — deterministic, order-independent cache-key string. Lossy/opaque,
//      never decodes back. Object keys sorted; arrays order-sensitive.
//   2. encode/decode — a rich, round-tripping codec for HYDRATION payloads (NOT the RPC
//      wire, which is plain JSON). Supports JSON primitives + undefined, BigInt, Date,
//      Map, Set, RegExp, URL, TypedArray/ArrayBuffer, and circular/shared references via a
//      flat ref table. Class instances, functions, and symbols are out (throw).

const TYPED_ARRAY_CONSTRUCTORS = {
    Int8Array,
    Uint8Array,
    Uint8ClampedArray,
    Int16Array,
    Uint16Array,
    Int32Array,
    Uint32Array,
    Float32Array,
    Float64Array,
    BigInt64Array,
    BigUint64Array,
} as const

type TypedArrayName = keyof typeof TYPED_ARRAY_CONSTRUCTORS

// ---------------------------------------------------------------------------
// canonicalKey
// ---------------------------------------------------------------------------

export function canonicalKey(value: unknown): string {
    // Scalar fast path — the overwhelmingly common memo-read arg. Returns without the cycle-guard Map:
    // a scalar can never form a cycle, so allocating one per read was dead work on the hottest path.
    if (value === null) return 'N'
    const kind = typeof value
    if (kind === 'string') return `s${quoteString(value as string)}`
    if (kind === 'number') return `n${numberToToken(value as number)}`
    if (kind === 'boolean') return value ? 'b1' : 'b0'
    if (kind === 'undefined') return 'U'
    if (kind === 'bigint') return `g${(value as bigint).toString()}`
    if (kind === 'symbol') throw new TypeError('canonicalKey: symbols are not supported')
    if (kind === 'function') throw new TypeError('canonicalKey: functions are not supported')
    // Reference type. The cycle guard is allocated LAZILY (see `writeKey`), not here: a `@n` back-
    // reference can only ever be EMITTED once a second reference value is reached, so a flat
    // `{ id, tab }` — the shape almost every memo/RPC read is keyed by — never needs the Map at all.
    return writeKey(value, null)
}

// JSON string quoting, minus the `JSON.stringify` call for the common case. `JSON.stringify` escapes
// exactly three classes: control chars (< 0x20), `"`, and `\` — plus lone surrogates, which it emits
// as `\udXXX`. A string containing none of those quotes to itself wrapped in `"`, so scanning for them
// and concatenating beats a stringify call (which dominated the object path — one per KEY NAME, and
// object keys are near-always plain identifiers). Falls back to `JSON.stringify` on any hit, so output
// stays byte-identical either way.
function quoteString(value: string): string {
    for (let i = 0; i < value.length; i++) {
        const code = value.charCodeAt(i)
        if (code < 0x20 || code === 0x22 || code === 0x5c || (code >= 0xd800 && code <= 0xdfff)) {
            return JSON.stringify(value)
        }
    }
    return `"${value}"`
}

// `seen` is null until a reference value is reached that could actually produce a back-reference; the
// callers below arm it (indexing THIS node as 0 first) at exactly the point the original eager version
// would have, so the `@n` indices are identical — they are assigned in the same depth-first pre-order.
function writeKey(value: unknown, seen: Map<object, number> | null): string {
    if (value === null) return 'N'
    const kind = typeof value
    if (kind === 'undefined') return 'U'
    if (kind === 'string') return `s${quoteString(value as string)}`
    if (kind === 'number') return `n${numberToToken(value as number)}`
    if (kind === 'boolean') return value ? 'b1' : 'b0'
    if (kind === 'bigint') return `g${(value as bigint).toString()}`
    if (kind === 'symbol') throw new TypeError('canonicalKey: symbols are not supported')
    if (kind === 'function') throw new TypeError('canonicalKey: functions are not supported')

    const object = value as object
    if (seen !== null) {
        const existing = seen.get(object)
        if (existing !== undefined) return `@${existing}`
        seen.set(object, seen.size)
    }

    // A plain object is what a memo/RPC arg almost always IS, so it is decided FIRST, by one prototype
    // read — ahead of the five `instanceof` checks + `ArrayBuffer.isView` the exotic types need. None of
    // those can be reached through this branch (each has its own prototype), so hoisting is free.
    const prototype = Object.getPrototypeOf(object)
    if (prototype === Object.prototype || prototype === null) return writeRecord(object, seen)

    if (object instanceof Date)
        return `D${Number.isNaN(object.getTime()) ? 'NaN' : object.getTime()}`
    if (object instanceof RegExp) return `R${object.source} ${object.flags}`
    if (object instanceof URL) return `L${object.href}`
    if (object instanceof ArrayBuffer) return `AB${bytesToBase64(new Uint8Array(object))}`
    if (ArrayBuffer.isView(object) && !(object instanceof DataView)) {
        const view = object as ArrayBufferView
        const name = (object.constructor as { name: string }).name
        const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
        return `TA${name}:${bytesToBase64(bytes)}`
    }

    if (Array.isArray(object)) {
        let guard = seen
        let out = 'A['
        for (let i = 0; i < object.length; i++) {
            if (i > 0) out += ','
            const element = object[i]
            if (guard === null && isReference(element)) guard = armGuard(object)
            out += writeKey(element, guard)
        }
        return `${out}]`
    }

    // Map/Set arm the guard eagerly rather than per-entry: their entries are near-always references,
    // and a Map/Set cache key is rare enough that the extra allocation is not worth the branch.
    if (object instanceof Map) {
        const guard = seen ?? armGuard(object)
        const entries: string[] = []
        for (const [entryKey, entryValue] of object) {
            entries.push(`${writeKey(entryKey, guard)}=>${writeKey(entryValue, guard)}`)
        }
        entries.sort()
        return `M{${entries.join(',')}}`
    }

    if (object instanceof Set) {
        const guard = seen ?? armGuard(object)
        const elements: string[] = []
        for (const element of object) elements.push(writeKey(element, guard))
        elements.sort()
        return `S{${elements.join(',')}}`
    }

    // Not a plain object (handled above), not an array, and not one of the supported exotics.
    throw new TypeError(
        `canonicalKey: unsupported value of type ${object.constructor?.name ?? 'unknown'} (class instances are not supported)`,
    )
}

// The plain-object (or null-prototype) walk: keys sorted so the key is order-independent.
function writeRecord(object: object, seen: Map<object, number> | null): string {
    const record = object as Record<string, unknown>
    const keys = Object.keys(record)
    if (keys.length > 1) keys.sort()
    let guard = seen
    let out = 'O{'
    for (let i = 0; i < keys.length; i++) {
        if (i > 0) out += ','
        const objectKey = keys[i] as string
        const child = record[objectKey]
        if (guard === null && isReference(child)) guard = armGuard(object)
        out += `${quoteString(objectKey)}:${writeKey(child, guard)}`
    }
    return `${out}}`
}

// Could this value take an index in the cycle guard (i.e. is it a reference the walk recurses into)?
// A `function` is excluded on purpose — `writeKey` throws on one, so arming for it would be dead work.
function isReference(value: unknown): boolean {
    return value !== null && typeof value === 'object'
}

// Arm the lazily-created cycle guard. Reaching the reference section with a null guard can only happen
// at the ROOT (a container arms before recursing into any reference child), so `node` always takes
// index 0 — the same index the previously-eager version assigned it.
function armGuard(node: object): Map<object, number> {
    const seen = new Map<object, number>()
    seen.set(node, 0)
    return seen
}

function numberToToken(value: number): string {
    if (Number.isNaN(value)) return 'NaN'
    if (value === Infinity) return 'Inf'
    if (value === -Infinity) return '-Inf'
    if (Object.is(value, -0)) return '-0'
    return String(value)
}

// ---------------------------------------------------------------------------
// encode / decode
// ---------------------------------------------------------------------------

// Wire shape: { root: Node, heap: Node[] }. Every value is encoded as a tagged array Node.
// Reference-typed values (object/array/Map/Set/Date/RegExp/URL/ArrayBuffer/TypedArray) are
// interned into `heap` and referenced by ["ref", index], which is what preserves shared and
// circular structure.

type Node = unknown[]

// `lossy` (used by the hydration-seed path) makes an encode-unsupported value — a symbol, function, or
// class instance — encode as a `null` node instead of throwing, so recording a page's state initials can
// never crash the render (the seed-contract "drop to null" guarantee). The strict default (throw) still
// guards any caller that must reject unrepresentable values.
export function encode(value: unknown, lossy = false): string {
    const heap: Node[] = []
    const seen = new Map<object, number>()
    const root = encodeNode(value, heap, seen, lossy)
    return JSON.stringify({ root, heap })
}

function encodeNode(value: unknown, heap: Node[], seen: Map<object, number>, lossy: boolean): Node {
    if (value === null) return ['null']
    const kind = typeof value
    if (kind === 'undefined') return ['u']
    if (kind === 'string') return ['s', value]
    if (kind === 'number') return encodeNumber(value as number)
    if (kind === 'boolean') return ['b', value]
    if (kind === 'bigint') return ['big', (value as bigint).toString()]
    if (kind === 'symbol') {
        if (lossy) return ['null']
        throw new TypeError('encode: symbols are not supported')
    }
    if (kind === 'function') {
        if (lossy) return ['null']
        throw new TypeError('encode: functions are not supported')
    }

    const object = value as object
    const existing = seen.get(object)
    if (existing !== undefined) return ['ref', existing]

    const index = heap.length
    seen.set(object, index)
    heap.push([]) // reserve slot before recursing so cycles resolve to this index
    heap[index] = encodeObjectLike(object, heap, seen, lossy)
    return ['ref', index]
}

function encodeObjectLike(
    object: object,
    heap: Node[],
    seen: Map<object, number>,
    lossy: boolean,
): Node {
    if (object instanceof Date) {
        const time = object.getTime()
        return ['date', Number.isNaN(time) ? 'NaN' : time]
    }
    if (object instanceof RegExp) return ['re', object.source, object.flags]
    if (object instanceof URL) return ['url', object.href]
    if (object instanceof ArrayBuffer) return ['ab', bytesToBase64(new Uint8Array(object))]
    if (ArrayBuffer.isView(object) && !(object instanceof DataView)) {
        const view = object as ArrayBufferView
        const name = (object.constructor as { name: string }).name
        const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
        return ['ta', name, bytesToBase64(bytes)]
    }

    if (Array.isArray(object)) {
        const elements: Node[] = []
        for (let i = 0; i < object.length; i++) {
            elements.push(encodeNode(object[i], heap, seen, lossy))
        }
        return ['arr', elements]
    }

    if (object instanceof Map) {
        const entries: [Node, Node][] = []
        for (const [entryKey, entryValue] of object) {
            entries.push([
                encodeNode(entryKey, heap, seen, lossy),
                encodeNode(entryValue, heap, seen, lossy),
            ])
        }
        return ['map', entries]
    }

    if (object instanceof Set) {
        const elements: Node[] = []
        for (const element of object) elements.push(encodeNode(element, heap, seen, lossy))
        return ['set', elements]
    }

    const prototype = Object.getPrototypeOf(object)
    if (prototype !== Object.prototype && prototype !== null) {
        if (lossy) return ['null']
        throw new TypeError(
            `encode: unsupported value of type ${object.constructor?.name ?? 'unknown'} (class instances have no revival path)`,
        )
    }

    const entries: [string, Node][] = []
    const record = object as Record<string, unknown>
    for (const objectKey of Object.keys(record)) {
        entries.push([objectKey, encodeNode(record[objectKey], heap, seen, lossy)])
    }
    return ['obj', entries]
}

function encodeNumber(value: number): Node {
    if (Number.isNaN(value)) return ['n', 'NaN']
    if (value === Infinity) return ['n', 'Inf']
    if (value === -Infinity) return ['n', '-Inf']
    if (Object.is(value, -0)) return ['n', '-0']
    return ['n', value]
}

export function decode(text: string): unknown {
    const parsed = JSON.parse(text) as { root: Node; heap: Node[] }
    const heap = parsed.heap
    const shells: unknown[] = new Array(heap.length)

    // Pass 1: build a shell for every heap entry. Leaf types are fully constructed; container
    // types get an empty shell so cyclic references can point at them before they are filled.
    for (const [i, heapNode] of heap.entries()) {
        shells[i] = buildShell(heapNode)
    }

    // Pass 2: fill container shells, resolving refs through the shell table.
    const resolve = (node: Node): unknown => resolveNode(node, shells)
    for (const [i, heapNode] of heap.entries()) {
        fillShell(heapNode, shells[i], resolve)
    }

    return resolveNode(parsed.root, shells)
}

function buildShell(node: Node): unknown {
    const tag = node[0] as string
    switch (tag) {
        case 'arr':
            return []
        case 'obj':
            return {}
        case 'map':
            return new Map()
        case 'set':
            return new Set()
        case 'date': {
            const time = node[1]
            return new Date(time === 'NaN' ? NaN : (time as number))
        }
        case 're':
            return new RegExp(node[1] as string, node[2] as string)
        case 'url':
            return new URL(node[1] as string)
        case 'ab':
            return base64ToArrayBuffer(node[1] as string)
        case 'ta': {
            const name = node[1] as TypedArrayName
            const Constructor = TYPED_ARRAY_CONSTRUCTORS[name]
            if (!Constructor) throw new TypeError(`decode: unknown TypedArray ${name}`)
            const buffer = base64ToArrayBuffer(node[2] as string)
            return new Constructor(buffer as ArrayBuffer)
        }
        // A reference-typed value dropped by lossy encoding (an unsupported class instance) was interned
        // before its prototype was known, so its reserved heap slot holds a `null` node. Resolve it to
        // null; `fillShell` leaves it untouched.
        case 'null':
            return null
        default:
            throw new TypeError(`decode: unexpected heap node tag ${tag}`)
    }
}

function fillShell(node: Node, shell: unknown, resolve: (node: Node) => unknown): void {
    const tag = node[0] as string
    if (tag === 'arr') {
        const array = shell as unknown[]
        const elements = node[1] as Node[]
        for (const element of elements) array.push(resolve(element))
        return
    }
    if (tag === 'obj') {
        const record = shell as Record<string, unknown>
        const entries = node[1] as [string, Node][]
        for (const entry of entries) {
            record[entry[0]] = resolve(entry[1])
        }
        return
    }
    if (tag === 'map') {
        const map = shell as Map<unknown, unknown>
        const entries = node[1] as [Node, Node][]
        for (const entry of entries) {
            map.set(resolve(entry[0]), resolve(entry[1]))
        }
        return
    }
    if (tag === 'set') {
        const set = shell as Set<unknown>
        const elements = node[1] as Node[]
        for (const element of elements) set.add(resolve(element))
        return
    }
    // Leaf types were fully constructed in buildShell; nothing to fill.
}

function resolveNode(node: Node, shells: unknown[]): unknown {
    const tag = node[0] as string
    switch (tag) {
        case 'null':
            return null
        case 'u':
            return undefined
        case 's':
            return node[1] as string
        case 'b':
            return node[1] as boolean
        case 'n':
            return decodeNumber(node[1])
        case 'big':
            return BigInt(node[1] as string)
        case 'ref':
            return shells[node[1] as number]
        default:
            throw new TypeError(`decode: unexpected value node tag ${tag}`)
    }
}

function decodeNumber(payload: unknown): number {
    if (typeof payload === 'number') return payload
    if (payload === 'NaN') return NaN
    if (payload === 'Inf') return Infinity
    if (payload === '-Inf') return -Infinity
    if (payload === '-0') return -0
    throw new TypeError(`decode: bad number payload ${String(payload)}`)
}

// ---------------------------------------------------------------------------
// base64 helpers (isomorphic: `Uint8Array.prototype.toBase64`/`Uint8Array.fromBase64` are web-standard
// and present in Bun AND the browser — `decode` runs client-side during hydration, where Bun's `Buffer`
// does not exist. `seal.ts` uses the same pair.)
// ---------------------------------------------------------------------------

function bytesToBase64(bytes: Uint8Array): string {
    return bytes.toBase64()
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
    return Uint8Array.fromBase64(base64).buffer as ArrayBuffer
}
