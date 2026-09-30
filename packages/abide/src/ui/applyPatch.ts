// 18.26 — WHAT A PATCH WROTE ON THE SERVER, WRITTEN AGAIN HERE: each op walked to its path and
// replayed. Called inside the copy's own `s.patch`, so the rows it reaches are the rows 32.33 remakes.
import { putOwn } from '#shared/putOwn.ts'
import type { PatchOp } from '#shared/reactive/PATCH_SINKS.ts'

/** Replays a server patch's ops onto `root`, each walked to its path. */
export function applyPatch(root: unknown, ops: PatchOp[]): void {
    for (const op of ops) {
        const path = op.path
        const call = 'call' in op
        // A call is made ON the object at its path; a set or a delete is made to its last key.
        const reach = call ? path.length : path.length - 1
        let held = root as Record<string | number, unknown>
        for (let at = 0; at < reach; at += 1)
            held = held[path[at] as string | number] as Record<
                string | number,
                unknown
            >
        if (call)
            (held[op.call] as (...args: unknown[]) => unknown).apply(
                held,
                op.args,
            )
        else if ('delete' in op) delete held[path[reach] as string | number]
        else putOwn(held, path[reach] as string | number, op.set)
    }
}
