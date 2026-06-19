import type { Doc } from './types/Doc.ts'

/*
Loads a `saved` snapshot (from the pre-swap instance) into a freshly-built `model`,
restoring the user's in-progress state across a hot swap. A shallow per-top-level-key
merge, not a wholesale root replace: a key present in both is restored from `saved`;
a key the edit ADDED keeps its fresh default; a key the edit REMOVED is not re-added.
So editing a component's state shape still loads cleanly instead of resurrecting a
stale tree. Each restored key is one patch, so only the changed slots re-render.
*/
export function seedModelDoc(model: Doc, saved: unknown): void {
    const current = model.snapshot()
    if (
        saved === null ||
        typeof saved !== 'object' ||
        current === null ||
        typeof current !== 'object'
    ) {
        return
    }
    for (const key of Object.keys(saved)) {
        if (key in current) {
            model.replace(key, (saved as Record<string, unknown>)[key])
        }
    }
}
