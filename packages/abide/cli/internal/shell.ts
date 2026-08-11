// `app.html` — the app's own document, wired to the build that is actually on disk.
//
// The file names SOURCES: `<script type="module" src="./client.ts">` and nothing about hashes,
// because a hash is a fact about a build and an app should not have to know one to write its own
// head. This maps each one through the manifest, which is the only thing that knows what a source
// compiled to — the same job Bun's own HTML entry point does, done here because the document is
// served rather than bundled.
//
// The stylesheets are the other half and they are NOT named at all. A `.abide` layout that writes
// `import './app.css'` has said the whole of it: the bundler pulled the css into the graph, wrote it
// beside the chunks, and the manifest records it — so the `<link>` is appended from what was BUILT
// rather than from what the html remembered to mention. An app that renames its stylesheet does not
// then have a document pointing at a file that no longer exists.

import { commented, DOCUMENT_OPEN, type Shell, shell, within } from '$server/shell.ts'
import { escape } from '$shared/html.ts'
import { CLIENT_ROUTE, type ClientAsset, type ClientManifest } from '../CLIENT_BUILD.ts'

/**
 * The app's own document. `.html` because that is what it is.
 *
 * Exported for the report: a process saying `app.html` when the author wrote `App.html` is the
 * shortest way to find out the file is not being read, and a second spelling in the line that PRINTS
 * it is how that message starts naming a file this never looked for.
 */
export const APP_HTML = 'app.html'

/** The document, and whether the app wrote it. `own` is only for what the command REPORTS. */
export interface AppShell {
    parts: Shell
    own: boolean
}

/**
 * The shell this app's pages render into: its own `app.html`, or abide's when it has none.
 *
 * Both go through the same `shell()`, so there is one answer to what a document IS and the built-in
 * one is not a second code path — it is a string that happens to be written here.
 */
export async function appShell(
    root: string,
    manifest: ClientManifest | null,
    name: string,
): Promise<AppShell> {
    const file = Bun.file(`${root}/${APP_HTML}`)
    const own = await file.exists()
    const parts = shell(built(own ? await file.text() : fallback(name, manifest), manifest))
    // `head` is BY DEFINITION the text before `</head>`, so appending to it puts the links exactly
    // where a second scan for `</head>` would have — found once, by the function that owns where a
    // head ends. An app's own `<link>` is already in there and still comes first.
    parts.head += stylesheets(manifest)
    return { parts, own }
}

// A source path in a `src` or an `href`. Quoted values only: an unquoted attribute cannot hold the
// `./` an app writes anyway, and a parser for the rest of HTML is not what this is.
const REFERENCE = /\b(src|href)="([^"]+)"/gi

/**
 * Every reference to a source the build produced, rewritten to the file it produced.
 *
 * A value that is not an entry is left EXACTLY as written — `href="https://…"`, `src="/logo.svg"`, a
 * font, an analytics script. The manifest is the whole of what this knows, so nothing else in an
 * app's document can be broken by a rewrite it did not ask for.
 */
function built(html: string, manifest: ClientManifest | null): string {
    if (manifest === null) return html
    const ranges = commented(html)
    return html.replace(REFERENCE, (whole, attribute: string, value: string, at: number) => {
        // A comment is not markup, and a shell that documents its own `src="./client.ts"` — the one
        // this repo ships does — must not have the sentence rewritten out from under it.
        if (within(ranges, at)) return whole
        const entry = manifest.entries[value.startsWith('./') ? value.slice(2) : value]
        return entry === undefined ? whole : `${attribute}="${CLIENT_ROUTE}${entry}"`
    })
}

/**
 * The stylesheets the build wrote, as `<link>` tags for the end of the head.
 *
 * Every css asset rather than the ones some entry claims: a client bundle is ONE lane, and the css
 * in it is the css its modules imported. At the end of the head so an app's own `<link>` — a font, a
 * reset — still comes first and can be overridden by what a component brought with it.
 */
function stylesheets(manifest: ClientManifest | null): string {
    if (manifest === null) return ''
    let tags = ''
    for (const name in manifest.assets) {
        if (!(manifest.assets[name] as ClientAsset).type.startsWith('text/css')) continue
        tags += `<link rel="stylesheet" href="${CLIENT_ROUTE}${name}">`
    }
    return tags
}

/**
 * What an app with no `app.html` is served in.
 *
 * Deliberately the shortest document that works, and it is here rather than in the renderer so that
 * reading it tells an app exactly what to copy into an `app.html` of its own: a head, a script naming
 * the client lane by its SOURCE path, and the slot the page renders into.
 */
function fallback(name: string, manifest: ClientManifest | null): string {
    const entry = manifest === null ? undefined : Object.keys(manifest.entries)[0]
    return (
        // The same opening `renderDocument` wraps a bare head in, rather than a second spelling of
        // it: there is one answer to what abide's own document is, and an app reading this one to
        // copy into an `app.html` should be reading that answer.
        DOCUMENT_OPEN +
        '<meta name="viewport" content="width=device-width, initial-scale=1">' +
        // Through the same escaper every text node the renderer writes goes through. An app name is
        // a package.json field or an `ABIDE_APP_NAME`, so it is text rather than markup.
        `<title>${escape(name)}</title>` +
        (entry === undefined ? '' : `<script type="module" src="./${entry}"></script>`) +
        '</head><body><slot></slot></body></html>'
    )
}
