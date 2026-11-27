// 18.41 — WHAT A REPLACED VALUE CHANGED, as the JSON Patch (RFC 6902) that turns the value before
// into the value after, so a follower is sent the change rather than the value. An array whose
// elements a `key` tells apart (32.32) is matched by key: an element edited is a `replace` of it, one
// moved is a `move`, and the rest stay where they stood — where by position, a row taken from the
// front of a list would replace every row after it.

import { deepEqual } from './deepEqual.ts'
import type { PatchOp } from './patchLog.ts'

type Key = string | ((element: unknown) => unknown) | null

/**
 * The ops turning `before` into `after`. SERIALIZED NOWHERE HERE: a change is serialized once for every
 * follower (18.6), and a value nothing in common with the last is one `replace` of the root, which is
 * the value whole.
 */
export function diffOps(before: unknown, after: unknown, key: Key): PatchOp[] {
    const ops: PatchOp[] = []
    diffInto(ops, '', before, after, key)
    return ops
}

// A plain record of data: one carrying its own `toJSON` is sent as that answers, so it is replaced whole.
function isRecord(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        return false
    if (typeof (value as { toJSON?: unknown }).toJSON === 'function')
        return false
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
}

/** RFC 6901 — a property name as one token of a JSON Pointer. */
function token(name: string | number): string {
    return String(name).replaceAll('~', '~0').replaceAll('/', '~1')
}

function diffInto(
    ops: PatchOp[],
    path: string,
    before: unknown,
    after: unknown,
    key: Key,
): void {
    if (deepEqual(after, before)) return
    if (Array.isArray(before) && Array.isArray(after)) {
        if (key === null) diffByPosition(ops, path, before, after)
        else diffByKey(ops, path, before, after, key)
        return
    }
    if (isRecord(before) && isRecord(after)) {
        for (const name of Object.keys(before))
            if (!(name in after))
                ops.push({ op: 'remove', path: `${path}/${token(name)}` })
        for (const name of Object.keys(after)) {
            const at = `${path}/${token(name)}`
            if (!(name in before))
                ops.push({ op: 'add', path: at, value: after[name] })
            else diffInto(ops, at, before[name], after[name], null)
        }
        return
    }
    ops.push({ op: 'replace', path, value: after })
}

function diffByPosition(
    ops: PatchOp[],
    path: string,
    before: unknown[],
    after: unknown[],
): void {
    const shared = Math.min(before.length, after.length)
    for (let at = 0; at < shared; at += 1)
        diffInto(ops, `${path}/${at}`, before[at], after[at], null)
    for (let at = before.length - 1; at >= after.length; at -= 1)
        ops.push({ op: 'remove', path: `${path}/${at}` })
    for (let at = shared; at < after.length; at += 1)
        ops.push({ op: 'add', path: `${path}/-`, value: after[at] })
}

function keyOf(element: unknown, key: Exclude<Key, null>): unknown {
    return typeof key === 'function'
        ? key(element)
        : (element as Record<string, unknown> | null)?.[key]
}

/**
 * The ops by key: what left is removed, then each position of `after` is filled from the element
 * already standing there, moved from later, or added.
 *
 * THE ARRAY THE OPS BUILD IS NEVER BUILT. Past the removes, positions `[0, at)` hold `after`'s first
 * `at` and the rest hold the survivors not yet placed, in their order — so an element's `from` is `at`
 * plus how many unplaced survivors stand before it, which a Fenwick tree over the survivors answers in
 * log time. Simulating it instead spliced per move and scanned per position: a full reverse was
 * quadratic, 82 ms at 10,000 rows.
 */
function diffByKey(
    ops: PatchOp[],
    path: string,
    before: unknown[],
    after: unknown[],
    key: Exclude<Key, null>,
): void {
    const wanted = new Set<unknown>()
    const afterKeys: unknown[] = []
    for (const element of after) {
        const id = keyOf(element, key)
        afterKeys.push(id)
        wanted.add(id)
    }
    const beforeKeys: unknown[] = []
    for (const element of before) beforeKeys.push(keyOf(element, key))
    for (let at = before.length - 1; at >= 0; at -= 1)
        if (!wanted.has(beforeKeys[at]))
            ops.push({ op: 'remove', path: `${path}/${at}` })
    // The survivors in order, and each key's survivors by their rank among them, taken first to last.
    const survivors: unknown[] = []
    const ranks = new Map<unknown, { ranks: number[]; next: number }>()
    for (let at = 0; at < before.length; at += 1) {
        const id = beforeKeys[at]
        if (!wanted.has(id)) continue
        let held = ranks.get(id)
        if (held === undefined) {
            held = { ranks: [], next: 0 }
            ranks.set(id, held)
        }
        held.ranks.push(survivors.length)
        survivors.push(before[at])
    }
    const unplaced = new Unplaced(survivors.length)
    for (let at = 0; at < after.length; at += 1) {
        const id = afterKeys[at]
        // `===`, as a scan for the key would compare: a NaN key matches nothing.
        const held = id === id ? ranks.get(id) : undefined
        const rank =
            held === undefined || held.next === held.ranks.length
                ? -1
                : (held.ranks[held.next++] as number)
        if (rank === -1) {
            ops.push({ op: 'add', path: `${path}/${at}`, value: after[at] })
            continue
        }
        const from = at + unplaced.before(rank)
        if (from !== at)
            ops.push({
                op: 'move',
                from: `${path}/${from}`,
                path: `${path}/${at}`,
            })
        unplaced.place(rank)
        diffInto(ops, `${path}/${at}`, survivors[rank], after[at], null)
    }
}

/** Which of `size` survivors are not yet placed, as a Fenwick tree of ones: counted below a rank in log time. */
class Unplaced {
    readonly tree: Int32Array
    constructor(size: number) {
        const tree = new Int32Array(size + 1)
        for (let index = 1; index <= size; index += 1) {
            tree[index] = (tree[index] as number) + 1
            const parent = index + (index & -index)
            if (parent <= size)
                tree[parent] =
                    (tree[parent] as number) + (tree[index] as number)
        }
        this.tree = tree
    }

    /** How many survivors ranked below `rank` are not yet placed. */
    before(rank: number): number {
        let count = 0
        for (let index = rank; index > 0; index -= index & -index)
            count += this.tree[index] as number
        return count
    }

    /** Marks the survivor at `rank` placed. */
    place(rank: number): void {
        const tree = this.tree
        for (let index = rank + 1; index < tree.length; index += index & -index)
            tree[index] = (tree[index] as number) - 1
    }
}
