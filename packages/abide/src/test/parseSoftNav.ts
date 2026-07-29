import { asSoftNavFrame, type SoftNavPatchFrame } from '../shared/internal/softNavFrame.ts'
import { STREAM_SENTINEL } from '../ui/internal/STREAM_SENTINEL.ts'

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

export async function parseSoftNav(response: Response): Promise<SoftNavEnvelope> {
    const text = await response.text()
    let html = ''
    let url: string | undefined
    let sharedLevels: number | undefined
    let seed: unknown = {}
    const patches: SoftNavPatchFrame[] = []
    // Decoded through the SHARED narrower — `createTestApp` states the principle this follows ("the
    // harness exists to catch protocol drift, so it must not run a second copy of the protocol"), and
    // this file used to hand-roll the frame union next to it.
    for (const line of text.split('\n')) {
        if (line.length === 0) continue
        const frame = asSoftNavFrame(JSON.parse(line))
        if (frame === undefined) continue
        if (frame.kind === 'shell') {
            html = frame.html
            url = frame.url
            sharedLevels = frame.sharedLevels
        } else if (frame.kind === 'seed') {
            seed = frame.seed
        } else {
            patches.push(frame)
        }
    }
    // The GEOMETRY is the shared constant's; the string patching is not, and deliberately stays local.
    // `streamPatchDom` owns the DOM ops both real transports run, but this helper's job is to hand a
    // test an HTML STRING to assert on — routing it through a DOM would re-serialize whitespace and
    // attribute order and churn every assertion that reads it. What it must not do is restate the
    // prefixes, which it did: a rename of `STREAM_SENTINEL.list` moved the emitter, the DOM ops and the
    // claim walk together and left these regexes matching nothing, so every `append` was silently
    // dropped and the tests asserted the unpatched shell — green, in the same direction as the bug.
    for (const patch of patches) {
        const { pending, list } = STREAM_SENTINEL
        if (patch.kind === 'fill') {
            // Replace everything between the opening comment sentinel and the id'd `<template>`.
            html = html.replace(
                new RegExp(
                    `(<!--${pending}${patch.id}-->)[\\s\\S]*?(<template id="${pending}${patch.id}">)`,
                ),
                `$1${patch.html}$2`,
            )
        } else {
            // `append`: insert before the list's trailing `<template id="<list><id>">` sentinel.
            html = html.replace(
                new RegExp(`(<template id="${list}${patch.id}")`),
                `${patch.html}$1`,
            )
        }
    }
    return { html, seed, url, sharedLevels }
}
