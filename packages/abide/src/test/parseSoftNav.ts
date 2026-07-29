// Test helper: reconstruct the soft-nav `{ html, seed, url }` shape from the STREAMED JSONL frame
// response (streaming-ssr-plan.md PR4 — soft-nav returns `{kind:"shell"}`, then patch frames whose kind
// is the op — `fill`/`append` — then `{kind:"seed"}`, instead of one buffered JSON envelope).
// `html` is the shell with each streamed patch applied — mirroring the browser's `applyPatchFrame`:
// `fill` replaces the pending fallback bracketed by `<!--ab-p:<id>-->` … `<template id="ab-p:<id>">`,
// `append` inserts an item before the `<template id="ab-l:<id>">` list sentinel — so assertions see the
// fully-assembled inner HTML.

export interface SoftNavEnvelope {
    html: string
    seed: unknown
    url?: string | undefined
    // How many outer layout levels the server SKIPPED rendering (C6.2) — the number the client checks
    // its own `keep` against, and the one `Abide-Nav-Keep` caps.
    sharedLevels?: number | undefined
}

type PatchFrame = { kind: 'fill' | 'append'; id: number; html: string }

export async function parseSoftNav(response: Response): Promise<SoftNavEnvelope> {
    const text = await response.text()
    let html = ''
    let url: string | undefined
    let sharedLevels: number | undefined
    let seed: unknown = {}
    const patches: PatchFrame[] = []
    for (const line of text.split('\n')) {
        if (line.length === 0) continue
        const frame = JSON.parse(line) as {
            kind: string
            html?: string
            url?: string
            id?: number
            seed?: unknown
            sharedLevels?: number
        }
        if (frame.kind === 'shell') {
            html = frame.html ?? ''
            url = frame.url
            sharedLevels = frame.sharedLevels
        } else if (frame.kind === 'seed') {
            seed = frame.seed ?? {}
        } else if (
            (frame.kind === 'fill' || frame.kind === 'append') &&
            typeof frame.id === 'number'
        ) {
            patches.push({ kind: frame.kind, id: frame.id, html: frame.html ?? '' })
        }
    }
    for (const patch of patches) {
        if (patch.kind === 'fill') {
            // Replace everything between the opening comment sentinel and the id'd `<template>`.
            html = html.replace(
                new RegExp(`(<!--ab-p:${patch.id}-->)[\\s\\S]*?(<template id="ab-p:${patch.id}">)`),
                `$1${patch.html}$2`,
            )
        } else {
            // `append`: insert before the list's trailing `<template id="ab-l:<id>">` sentinel.
            html = html.replace(new RegExp(`(<template id="ab-l:${patch.id}")`), `${patch.html}$1`)
        }
    }
    return { html, seed, url, sharedLevels }
}
