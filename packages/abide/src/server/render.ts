// 35.4 and 35.5 — `render` takes a component already bound to its props and produces the document
// as an async generator of bytes.

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

// What a compiled component answers. One reference beyond the cast that reads it — the `await`
// guard needs the settled shape and the promise shape to be the same name.
type Rendered = { head: string; body: string }

// 35.1 — THE PAGE, INSIDE ITS LAYOUTS, outermost first. A layout renders its child through a
// slot (32.19), so the composition is the same `children` thunk a caller writing markup between
// two tags hands over — there is no layout API and no second kind of component, which is what
// the documentation says a layout is and what this is.
//
// THE HEADS COME UP WITH THE BODY. A layout's own contributions are in the record it answers;
// what the page under it contributed is pushed as the thunk runs, so the document carries both
// and the order is the tree's (39.5).
export function composePage(
    layouts: Component[],
    page: Component,
    props: Record<string, () => unknown>,
): Rendered {
    const heads: string[] = []
    const inner = (at: number): Rendered => {
        const component = (at === layouts.length ? page : layouts[at]) as (
            props: Record<string, () => unknown>,
        ) => Rendered
        if (at === layouts.length) return component(props)
        return component({
            ...props,
            children: () => {
                const below = inner(at + 1)
                if (below.head !== '') heads.push(below.head)
                return below.body
            },
        })
    }
    const outermost = inner(0)
    return { head: outermost.head + heads.join(''), body: outermost.body }
}

export async function* render(
    component: Component,
    shell?: Shell,
): AsyncGenerator<Uint8Array> {
    // 34.3 — SETUP IS SYNCHRONOUS, so a component answers its record outright and nothing here
    // waits for it.
    const rendered = (component as () => Rendered)()
    // GUARDED, because the string form is already settled: `shellText` is `async`, so awaiting it
    // unconditionally wrapped a promise and spent a microtask turn per request for nothing.
    const document = typeof shell === 'string' ? shell : await shellText(shell)

    // TWO INSERTION POINTS, CLAMPED AND ORDERED — not three shapes. `</head>` and `</body>` are
    // both OPTIONAL end tags, so a valid shell can carry neither, and the three hand-written arms
    // this replaces dropped `rendered.head` on the floor in two of them: a page's `<title>`,
    // `<meta>` and stylesheet links vanished with no error. A shell whose `</head>` came AFTER its
    // `</body>` made `slice(headAt, bodyAt)` empty and duplicated the head region on top of that.
    // An absent anchor now means "the end of the document", and the clamp is what keeps the head
    // ahead of the body whatever order the shell wrote them in.
    const bodyAt = bodyAnchor(document)
    const headAt = headAnchor(document)
    // Two chunks, split at the head, so what the document needs to start fetching is on the wire
    // before the body is built. 41.1 makes that a requirement rather than a courtesy and is not
    // implemented yet — this is the shape it will need, not the guarantee.
    yield ENCODER.encode(document.slice(0, headAt) + rendered.head)
    yield ENCODER.encode(
        document.slice(headAt, bodyAt) + rendered.body + document.slice(bodyAt),
    )
}

// Where the body's content ends, which is where a page's markup goes.
function bodyAnchor(document: string): number {
    const found = document.lastIndexOf('</body>')
    return found === -1 ? document.length : found
}

// Where a shell's head ends, clamped ahead of its body.
//
// NOT PUBLIC SURFACE: `server/index.ts` does not re-export it. `serveBuild` is the second caller —
// a shell has to carry the client entry's script tag (38.23), and putting that anywhere but the
// head this finds is the same clamped-and-ordered question over again.
export function headAnchor(document: string): number {
    const bodyAt = bodyAnchor(document)
    // THE OPENING `<body` IS THE FALLBACK, not the body anchor. Collapsed onto `bodyAt`, a shell
    // with no `</head>` put the page's `<title>`, `<meta>` and stylesheet links after the mount
    // point and inside `<body>` — still rendered, in the one place a document says they are not
    // head content.
    const headClose = document.lastIndexOf('</head>')
    const found = headClose === -1 ? bodyOpen(document) : headClose
    return found === -1 || found > bodyAt ? bodyAt : found
}

// Where `<body` opens, or -1. Matched on the tag name rather than on `<body>` so an attribute on
// it — `<body class="…">`, which a shell usually has — is still found. Case-insensitive without
// lowercasing a copy of the whole shell.
function bodyOpen(document: string): number {
    return document.search(/<body(?=[\s>]|$)/i)
}

// The URL and absent forms only — the string form is already settled and its caller above takes
// it without a turn, so a second copy of that test here is a branch nothing reaches and a second
// owner of the question.
async function shellText(shell: URL | undefined): Promise<string> {
    if (shell !== undefined) return await Bun.file(shell).text()
    return await shellUnder('src')
}

// 35.6's default, read from a ROOT rather than from the process's directory. `render` on its own
// is called from wherever the app is, so `src` is the root it passes; `serveBuild` is handed the
// root `abide build` compiled and the two need not be the same directory. NOT PUBLIC SURFACE —
// `server/index.ts` does not re-export it.
export async function shellUnder(root: string): Promise<string> {
    // One syscall rather than two: `.text()` already fails when the file is not there, which is
    // the question `.exists()` was asked ahead of it. The read still happens per render for a
    // bare `render` call — 20 µs and 98% of the op — and `serveBuild` is the caller that hoists
    // it, reading the shell once at boot rather than once a request.
    try {
        return await Bun.file(`${root}/ui/app.html`).text()
    } catch (thrown) {
        // NARROWED TO THE ONE CASE THE LINE ABOVE ARGUES FOR. A bare catch made every failure look
        // like an absent file, so a project that HAS a shell which is momentarily unreadable —
        // EACCES, EISDIR, EMFILE under load — was served the bare shell with no stylesheet, no
        // client script and nothing said, on one request in a thousand.
        if ((thrown as { code?: unknown }).code !== 'ENOENT') throw thrown
        return BARE_SHELL
    }
}
