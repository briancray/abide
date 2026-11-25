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
 * already standing there, moved from later, or added — the array the ops build is walked alongside.
 */
function diffByKey(
    ops: PatchOp[],
    path: string,
    before: unknown[],
    after: unknown[],
    key: Exclude<Key, null>,
): void {
    const wanted = new Set<unknown>()
    for (const element of after) wanted.add(keyOf(element, key))
    const current = before.slice()
    for (let at = current.length - 1; at >= 0; at -= 1)
        if (!wanted.has(keyOf(current[at], key))) {
            ops.push({ op: 'remove', path: `${path}/${at}` })
            current.splice(at, 1)
        }
    for (let at = 0; at < after.length; at += 1) {
        const target = after[at]
        const id = keyOf(target, key)
        let from = -1
        for (let look = at; look < current.length; look += 1)
            if (keyOf(current[look], key) === id) {
                from = look
                break
            }
        if (from === -1) {
            ops.push({ op: 'add', path: `${path}/${at}`, value: target })
            current.splice(at, 0, target)
            continue
        }
        if (from !== at) {
            ops.push({
                op: 'move',
                from: `${path}/${from}`,
                path: `${path}/${at}`,
            })
            current.splice(at, 0, ...current.splice(from, 1))
        }
        diffInto(ops, `${path}/${at}`, current[at], target, null)
    }
}
