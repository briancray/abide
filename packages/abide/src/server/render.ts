// 35.4 and 35.5 — `render` takes a component already bound to its props and produces the
// document as an async generator of bytes.

// REGISTRY declares `Component` opaque. What a compiled component IS today is a function
// returning its markup, and the cast lives here, in one place, rather than in the type an app
// reads. It becomes a richer thing when a component takes props (33) and holds state (34.1).
// The emptiness IS the surface — a component is opaque to an app — so narrowing it here to
// satisfy the linter would put the code and the registry row out of step, which is the drift
// the documents exist to stop.
// biome-ignore lint/suspicious/noEmptyInterface: REGISTRY declares `interface Component {}`.
export interface Component {}

// 35.6 — the document a render renders into, defaulting to `src/ui/app.html`.
export type Shell = string | URL | undefined

// Where a shell was not given and `src/ui/app.html` is not there either. The rulebook does not
// say what happens in that case; serving nothing would be worse than serving this.
const BARE_SHELL = '<!doctype html><html><head></head><body></body></html>'

const ENCODER = new TextEncoder()

export async function* render(
    component: Component,
    shell?: Shell,
): AsyncGenerator<Uint8Array> {
    const rendered = (component as () => { head: string; body: string })()
    const document = await shellText(shell)

    const headAt = document.lastIndexOf('</head>')
    const bodyAt = document.lastIndexOf('</body>')
    if (bodyAt === -1) {
        yield ENCODER.encode(document + rendered.body)
        return
    }
    // Two chunks, split at the head, so what the document needs to start fetching is on the wire
    // before the body is built. 41.1 makes that a requirement rather than a courtesy and is not
    // implemented yet — this is the shape it will need, not the guarantee.
    if (headAt === -1) {
        yield ENCODER.encode(document.slice(0, bodyAt))
        yield ENCODER.encode(rendered.body + document.slice(bodyAt))
        return
    }
    yield ENCODER.encode(document.slice(0, headAt) + rendered.head)
    yield ENCODER.encode(
        document.slice(headAt, bodyAt) + rendered.body + document.slice(bodyAt),
    )
}

async function shellText(shell: Shell): Promise<string> {
    if (typeof shell === 'string') return shell
    if (shell instanceof URL) return await Bun.file(shell).text()
    const dflt = Bun.file('src/ui/app.html')
    return (await dflt.exists()) ? await dflt.text() : BARE_SHELL
}
