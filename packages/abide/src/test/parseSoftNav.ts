// Test helper: reconstruct the soft-nav `{ html, seed, url }` shape from the STREAMED JSONL frame
// response (streaming-ssr-plan.md PR4 — soft-nav returns `{kind:"shell"}`, then patch frames whose kind
// is the op — `fill`/`append`/`complete` — then `{kind:"seed"}`, instead of one buffered JSON envelope).
// `html` is the shell with each streamed patch applied — mirroring the browser's `applyPatchFrame`:
// `fill` replaces a deferred `<abide-slot id="ab-p:<id>">` placeholder's contents, `append` adds an item
// inside the `<abide-list id="ab-l:<id>">` anchor, `complete` stamps `data-ab-done` on it — so
// assertions see the fully-assembled inner HTML.

export interface SoftNavEnvelope {
    html: string
    seed: unknown
    url?: string | undefined
}

type PatchFrame = { kind: 'fill' | 'append' | 'complete'; id: number; html: string }

export async function parseSoftNav(response: Response): Promise<SoftNavEnvelope> {
    const text = await response.text()
    let html = ''
    let url: string | undefined
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
        }
        if (frame.kind === 'shell') {
            html = frame.html ?? ''
            url = frame.url
        } else if (frame.kind === 'seed') {
            seed = frame.seed ?? {}
        } else if (
            (frame.kind === 'fill' || frame.kind === 'append' || frame.kind === 'complete') &&
            typeof frame.id === 'number'
        ) {
            patches.push({ kind: frame.kind, id: frame.id, html: frame.html ?? '' })
        }
    }
    for (const patch of patches) {
        if (patch.kind === 'fill') {
            html = html.replace(
                new RegExp(`(<abide-slot id="ab-p:${patch.id}"[^>]*>)[\\s\\S]*?(</abide-slot>)`),
                `$1${patch.html}$2`,
            )
        } else if (patch.kind === 'append') {
            // Insert before the list anchor's closing tag (append into `<abide-list id="ab-l:<id>">`).
            html = html.replace(
                new RegExp(`(<abide-list id="ab-l:${patch.id}"[^>]*>[\\s\\S]*?)(</abide-list>)`),
                `$1${patch.html}$2`,
            )
        } else {
            // `complete`: stamp the finished marker on the list anchor if not already present.
            html = html.replace(
                new RegExp(`(<abide-list id="ab-l:${patch.id}")((?![^>]*data-ab-done)[^>]*>)`),
                `$1 data-ab-done$2`,
            )
        }
    }
    return { html, seed, url }
}
