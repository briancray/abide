// 18.11 — WHAT A PATCH WROTE, WRITTEN AGAIN HERE: a JSON Patch (RFC 6902) applied in order, each op's
// `path` a JSON Pointer (RFC 6901). Called inside the value's own `s.patch`, so the rows it reaches are
// the rows 32.33 remakes. A browser replays the server's writes.
//
// A pointer walks own properties alone, and an array step is an index or, for `add`, `-`. Every op a
// patch records passes, so the check costs a browser replaying its server nothing, and an op naming
// `__proto__` or a member off the prototype chain is refused at 400 rather than reached. A `test` that fails is 409, the patch's precondition rather than its form.
import { putOwn } from './putOwn.ts'
import type { PatchOp } from './reactive/PATCH_SINKS.ts'
import { structural } from './reactive/structural.ts'
import { refuse } from './refuse.ts'

type Container = Record<string | number, unknown>

/** Applies `ops` to `root` in order, in place; throws the refusal of the first one it cannot. */
export function applyPatch(root: unknown, ops: PatchOp[]): void {
    for (const op of ops) {
        if (op.op === 'add') add(root, op.path, op.value)
        else if (op.op === 'remove') remove(root, op.path)
        else if (op.op === 'replace') replace(root, op.path, op.value)
        else if (op.op === 'move') {
            const moved = valueAt(root, op.from)
            remove(root, op.from)
            add(root, op.path, moved)
        } else if (op.op === 'copy')
            add(root, op.path, structuredClone(valueAt(root, op.from)))
        else if (op.op === 'test') {
            if (!structural(valueAt(root, op.path), op.value))
                throw refuse(
                    409,
                    `abide: a patch's test failed at \`${op.path}\`.`,
                )
        } else
            throw refuse(
                400,
                `abide: a patch named an operation JSON Patch has not.`,
            )
    }
}

/** The unescaped steps of a JSON Pointer: `''` is the root, and `~1` is `/` and `~0` is `~`. */
function stepsOf(pointer: string): string[] {
    if (pointer === '') return []
    if (!pointer.startsWith('/'))
        throw refuse(
            400,
            `abide: a patch path must start with \`/\` — not \`${pointer}\`.`,
        )
    const steps = pointer.slice(1).split('/')
    for (let at = 0; at < steps.length; at += 1)
        steps[at] = (steps[at] as string)
            .replaceAll('~1', '/')
            .replaceAll('~0', '~')
    return steps
}

/** The container a pointer's last step is taken in, walked own property by own property. */
function parentOf(root: unknown, steps: string[]): Container {
    let held = root
    for (let at = 0; at < steps.length - 1; at += 1)
        held = stepInto(held, steps[at] as string)
    if (held === null || typeof held !== 'object')
        throw refuse(
            400,
            `abide: a patch path runs through a value that holds nothing.`,
        )
    return held as Container
}

function stepInto(held: unknown, step: string): unknown {
    if (
        held === null ||
        typeof held !== 'object' ||
        !Object.hasOwn(held, keyIn(held, step))
    )
        throw refuse(400, `abide: a patch named a path with no \`${step}\`.`)
    return (held as Container)[keyIn(held, step)]
}

/** An array's step as its index, where it is one; any other container's as the key it is. */
function keyIn(held: object, step: string): string | number {
    if (!Array.isArray(held)) return step
    if (!/^(0|[1-9][0-9]*)$/.test(step))
        throw refuse(400, `abide: a patch named \`${step}\` in an array.`)
    return Number(step)
}

function valueAt(root: unknown, pointer: string): unknown {
    let held = root
    for (const step of stepsOf(pointer)) held = stepInto(held, step)
    return held
}

function add(root: unknown, pointer: string, value: unknown): void {
    const steps = stepsOf(pointer)
    if (steps.length === 0) {
        replaceRoot(root, value)
        return
    }
    const parent = parentOf(root, steps)
    const last = steps[steps.length - 1] as string
    if (Array.isArray(parent)) {
        if (last === '-') {
            parent.push(value)
            return
        }
        const index = keyIn(parent, last) as number
        if (index > parent.length)
            throw refuse(400, `abide: a patch added past the end of an array.`)
        parent.splice(index, 0, value)
    } else putOwn(parent, last, value)
}

function remove(root: unknown, pointer: string): void {
    const steps = stepsOf(pointer)
    if (steps.length === 0)
        throw refuse(400, `abide: a patch cannot remove the whole value.`)
    const parent = parentOf(root, steps)
    const key = keyIn(parent, steps[steps.length - 1] as string)
    if (!Object.hasOwn(parent, key))
        throw refuse(
            400,
            `abide: a patch removed \`${key}\`, which is not there.`,
        )
    if (Array.isArray(parent)) parent.splice(key as number, 1)
    else delete parent[key]
}

function replace(root: unknown, pointer: string, value: unknown): void {
    const steps = stepsOf(pointer)
    if (steps.length === 0) {
        replaceRoot(root, value)
        return
    }
    const parent = parentOf(root, steps)
    const key = keyIn(parent, steps[steps.length - 1] as string)
    if (!Object.hasOwn(parent, key))
        throw refuse(
            400,
            `abide: a patch replaced \`${key}\`, which is not there.`,
        )
    putOwn(parent, key, value)
}

/**
 * The whole value replaced in place, since `s.patch` mutates what it serves rather than swapping it.
 *
 * An array takes the new one's elements and an object its members; a value of another shape cannot
 * be replaced by mutation, so a patch writing one is refused.
 */
function replaceRoot(root: unknown, value: unknown): void {
    if (Array.isArray(root) && Array.isArray(value)) {
        root.splice(0, root.length, ...value)
        return
    }
    if (
        root !== null &&
        typeof root === 'object' &&
        !Array.isArray(root) &&
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value)
    ) {
        for (const key of Object.keys(root)) delete (root as Container)[key]
        for (const key of Object.keys(value))
            putOwn(root as Container, key, (value as Container)[key])
        return
    }
    throw refuse(
        400,
        `abide: a patch replaced the whole value with one of another shape.`,
    )
}
