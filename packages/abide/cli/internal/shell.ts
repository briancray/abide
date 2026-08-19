// `app.html` — the app's own document, with what the build wrote appended to it.
//
// The file names NOTHING of abide's, and that is the whole shape of it: a document carries what is
// the APP's — its `lang`, its fonts, its analytics snippet, its own `<link>` — and nothing whose
// address is a fact about a build. The script and the stylesheets are both appended here from the
// manifest, which is the only thing that knows what a source compiled to.
//
// The stylesheets have worked this way all along. A `.abide` layout that writes `import './app.css'`
// has said the whole of it: the bundler pulled the css into the graph, wrote it beside the chunks,
// and the manifest records it — so an app that renames its stylesheet does not then have a document
// pointing at a file that no longer exists. The script was the exception and is not one now: the
// lane is generated from `pages/` for every app (`internal/entry.ts`), so a hand-written
// `src="./client.ts"` named a file the author never wrote, and was resolved only by a conventional
// manifest key that existed to keep the fiction working.

import { APP_HTML } from '#compiler/LAYOUT.ts'
import { ownDocument, type Shell, shell } from '#server/shell.ts'
import { escape } from '#shared/html.ts'
import { MOUNT_META, mountBase, mounted } from '#shared/internal/mount.ts'
import { CLIENT_ROUTE, type ClientAsset, type ClientManifest, GENERATED_ENTRY } from '../CLIENT_BUILD.ts'

/**
 * The app's own document, from the file that says where anything in an app is.
 *
 * Re-exported rather than imported by the report directly: a process saying `src/ui/app.html` when
 * the author wrote `App.html` is the shortest way to find out the file is not being read, and a
 * second spelling in the line that PRINTS it is how that message starts naming a file this never
 * looked for.
 */
export { APP_HTML }

/** The document and the lane the app's pages render into. */
export interface AppShell {
    /** The app's own document, cut, with the build's stylesheets already in the head. */
    parts: Shell
    /**
     * The `<meta>` and the `<script type="module">` that boot the client, held APART from the head.
     *
     * A page always wants them and a render outside the pages directory usually does not — `render`'s
     * `hydrate` is that ask, and the client mounts the pages route table at the outlet, so a document
     * carrying the lane on a path no page owns renders that table's answer over what was served.
     */
    lane: string
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
    /**
     * The document, when the caller already has it — a compiled binary, where `app.html` is text the
     * compile read and embedded rather than a file this process can open. `null` is that caller
     * saying the app wrote none. Absent is every other caller: read it off the disk.
     */
    written?: string | null,
): Promise<AppShell> {
    // Read rather than probed-then-read, the rule `lane.ts` states for the same shape: `exists()` is a
    // second syscall in front of the one that already answers the question, and whether the app wrote
    // its own shell falls out of whether the read threw.
    let text: string
    if (written !== undefined) {
        text = written ?? ownDocument(name)
    } else {
        try {
            text = await Bun.file(`${root}/${APP_HTML}`).text()
        } catch (failure) {
            // Only NOT THERE means the app wrote none. An `app.html` that is there and cannot be read
            // is a shell somebody meant to serve, so it throws rather than being quietly replaced by
            // abide's.
            if ((failure as { code?: string }).code !== 'ENOENT') throw failure
            text = ownDocument(name)
        }
    }
    const parts = shell(text)
    // `head` is BY DEFINITION the text before `</head>`, so appending to it puts the stylesheets
    // exactly where a second scan for `</head>` would have — found once, by the function that owns
    // where a head ends. An app's own `<link>` is already in there and still comes first.
    parts.head += stylesheets(manifest)
    return { parts, lane: mountMeta() + clientScript(manifest) }
}

/**
 * Where the app is mounted, for the CLIENT to read back — the one fact the browser half of routing
 * cannot work out for itself.
 *
 * The server knows it from `APP_URL`; the bundle cannot, because a mount is a deploy-time value and
 * the bundle was built before anyone chose one. So the DOCUMENT carries it, which is also the only
 * carrier that survives an app serving its assets from a CDN — deriving the base from where the
 * bundle came from would then name the CDN.
 *
 * A `<meta>` rather than an inline script: `csp()`'s `script-src` has no `'unsafe-inline'` and the
 * head is cut ONCE at boot, so it has no per-render nonce to carry — the same constraint that made
 * `abide dev`'s reload client a file. Emitted only when there IS a mount, so the overwhelming case is
 * a document with nothing extra in it.
 */
function mountMeta(): string {
    const base = mountBase()
    return base === '' ? '' : `<meta name="${MOUNT_META}" content="${escape(base)}">`
}

/**
 * The lane the browser is handed, as the one tag that boots it.
 *
 * `type="module"` is deferred by definition, so the head is where it costs nothing to put and where
 * the preload scanner finds it first. Absent when there is no bundle at all, which is an app made of
 * endpoints — and an app whose build FAILED, where `abide dev` serves the document anyway so the
 * error on the page is the app's rather than a 404 for a chunk.
 */
function clientScript(manifest: ClientManifest | null): string {
    const lane = manifest === null ? undefined : manifest.entries[GENERATED_ENTRY]
    return lane === undefined ? '' : `<script type="module" src="${mounted(CLIENT_ROUTE)}${lane}"></script>`
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
        tags += `<link rel="stylesheet" href="${mounted(CLIENT_ROUTE)}${name}">`
    }
    return tags
}

