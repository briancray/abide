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
    if (kind === 'string') return `s${JSON.stringify(value)}`
    if (kind === 'number') return `n${numberToToken(value as number)}`
    if (kind === 'boolean') return value ? 'b1' : 'b0'
    if (kind === 'undefined') return 'U'
    if (kind === 'bigint') return `g${(value as bigint).toString()}`
    if (kind === 'symbol') throw new TypeError('canonicalKey: symbols are not supported')
    if (kind === 'function') throw new TypeError('canonicalKey: functions are not supported')
    // Reference type — allocate the cycle guard only now, then walk the structure.
    return writeKey(value, new Map<object, number>())
}

function writeKey(value: unknown, seen: Map<object, number>): string {
    if (value === null) return 'N'
    const kind = typeof value
    if (kind === 'undefined') return 'U'
    if (kind === 'string') return `s${JSON.stringify(value)}`
    if (kind === 'number') return `n${numberToToken(value as number)}`
    if (kind === 'boolean') return value ? 'b1' : 'b0'
    if (kind === 'bigint') return `g${(value as bigint).toString()}`
    if (kind === 'symbol') throw new TypeError('canonicalKey: symbols are not supported')
    if (kind === 'function') throw new TypeError('canonicalKey: functions are not supported')

    const object = value as object
    const existing = seen.get(object)
    if (existing !== undefined) return `@${existing}`
    seen.set(object, seen.size)

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
        let out = 'A['
        for (let i = 0; i < object.length; i++) {
            if (i > 0) out += ','
            out += writeKey(object[i], seen)
        }
        return `${out}]`
    }

    if (object instanceof Map) {
        const entries: string[] = []
        for (const [entryKey, entryValue] of object) {
            entries.push(`${writeKey(entryKey, seen)}=>${writeKey(entryValue, seen)}`)
        }
        entries.sort()
        return `M{${entries.join(',')}}`
    }

    if (object instanceof Set) {
        const elements: string[] = []
        for (const element of object) elements.push(writeKey(element, seen))
        elements.sort()
        return `S{${elements.join(',')}}`
    }

    const prototype = Object.getPrototypeOf(object)
    if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError(
            `canonicalKey: unsupported value of type ${object.constructor?.name ?? 'unknown'} (class instances are not supported)`,
        )
    }

    const record = object as Record<string, unknown>
    const keys = Object.keys(record).sort()
    let out = 'O{'
    for (let i = 0; i < keys.length; i++) {
        if (i > 0) out += ','
        const objectKey = keys[i] as string
        out += `${JSON.stringify(objectKey)}:${writeKey(record[objectKey], seen)}`
    }
    return `${out}}`
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
