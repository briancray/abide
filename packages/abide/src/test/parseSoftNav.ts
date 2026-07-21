// Test helper: reconstruct the soft-nav `{ html, seed, url }` shape from the STREAMED JSONL frame
// response (streaming-ssr-plan.md PR4 — soft-nav returns `{kind:"shell"}`, `{kind:"patch"}`*,
// `{kind:"seed"}` frames instead of one buffered JSON envelope). `html` is the shell with each streamed
// patch spliced into its `<abide-slot>` placeholder, so assertions see the fully-assembled inner HTML.

export interface SoftNavEnvelope {
    html: string
    seed: unknown
    url?: string | undefined
}

export async function parseSoftNav(response: Response): Promise<SoftNavEnvelope> {
    const text = await response.text()
    let html = ''
    let url: string | undefined
    let seed: unknown = {}
    const patches: Array<{ id: number; html: string }> = []
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
        } else if (frame.kind === 'patch' && typeof frame.id === 'number') {
            patches.push({ id: frame.id, html: frame.html ?? '' })
        } else if (frame.kind === 'seed') {
            seed = frame.seed ?? {}
        }
    }
    for (const patch of patches) {
        html = html.replace(
            new RegExp(`(<abide-slot id="ab-p:${patch.id}"[^>]*>)[\\s\\S]*?(</abide-slot>)`),
            `$1${patch.html}$2`,
        )
    }
    return { html, seed, url }
}
