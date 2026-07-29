// THE SOFT-NAV FRAME STREAM — abide's other wire protocol, declared.
//
// An in-app navigation streams JSONL frames instead of one buffered `{html, seed}` envelope, so a slow
// read shows the shell then streams in. The producer emitted them through `frame(obj: unknown)` and
// every consumer re-tested the fields by hand — `typeof frame.html === 'string'`, `typeof
// frame.sharedLevels === 'number'`, `frame.seed as HydrationSeed` — across three reader loops in
// `navigate.ts` plus the test harness. Nothing type-checked the crossing, which is the same state the
// RPC wire spec was in before `rpcSpec.ts`.
//
// `sharedLevels` shows why that matters: it exists only on the shell frame, and only ONE of the three
// readers consults it (the full-nav path, which hard-loads when a server too old to honour
// `Abide-Nav-Keep` sends a trimmed shell). The partial-cross path deliberately does not, because
// `keep` is what it asked for. That asymmetry is correct and was invisible — a fourth reader had
// nothing to consult, and a new field would have been a silent no-op in whichever loop forgot it.

import type { HydrationSeed } from './hydrationSeed.ts'

// The shell of the destination — the whole page on a full nav, or just the diverging suffix when the
// client is keeping outer layouts (C6.2). `sharedLevels` is how many levels the server SKIPPED.
export interface SoftNavShellFrame {
    kind: 'shell'
    html: string
    url: string
    sharedLevels: number
}

// One out-of-order patch as it resolves: `fill` a deferred `{#await}` slot, `append` a streamed
// `{#for await}` item. The `kind` IS the patch op — the same two names `streamScheduler.Patch` uses.
export interface SoftNavPatchFrame {
    kind: 'fill' | 'append'
    id: number
    html: string
}

// Collected AFTER the drain, so streamed reads are included. Always last.
export interface SoftNavSeedFrame {
    kind: 'seed'
    seed: HydrationSeed
}

export type SoftNavFrame = SoftNavShellFrame | SoftNavPatchFrame | SoftNavSeedFrame

// Narrow a decoded line. The frames arrive off the network, so this is the one place the shape is
// checked rather than each reader guarding the fields it happens to use — and an unrecognised kind
// (a server newer than this bundle) is `undefined` rather than a throw, so a rolling deploy degrades
// to ignoring a frame instead of aborting the nav.
export function asSoftNavFrame(value: unknown): SoftNavFrame | undefined {
    if (value === null || typeof value !== 'object') return undefined
    const frame = value as Record<string, unknown>
    if (frame.kind === 'shell') {
        if (typeof frame.html !== 'string') return undefined
        return {
            kind: 'shell',
            html: frame.html,
            url: typeof frame.url === 'string' ? frame.url : '',
            // A server that predates `sharedLevels` sent none, which means it trimmed nothing.
            sharedLevels: typeof frame.sharedLevels === 'number' ? frame.sharedLevels : 0,
        }
    }
    if (frame.kind === 'fill' || frame.kind === 'append') {
        if (typeof frame.id !== 'number' || typeof frame.html !== 'string') return undefined
        return { kind: frame.kind, id: frame.id, html: frame.html }
    }
    if (frame.kind === 'seed') {
        if (frame.seed === null || typeof frame.seed !== 'object') return undefined
        return { kind: 'seed', seed: frame.seed as HydrationSeed }
    }
    return undefined
}
