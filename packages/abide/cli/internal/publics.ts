// `src/ui/public/**` — files served AS THEY ARE, from the origin root.
//
// The other static layer, and deliberately not the same one: `assets.ts` serves a BUILD, where every
// name carries a content hash and the manifest is the allowlist. Nothing here was built. The names
// are whatever the author typed, so they are cached for a short while rather than forever.
//
// There is no path traversal to defend against and no check pretending to: a request path is looked
// up as a KEY in a map built by scanning the directory at boot. No string from a caller is ever
// joined onto a path, so `../` is a miss like any other name this app does not have.
//
// In front of the request pipeline for the reason the bundle is: a favicon has no caller to be about,
// and a page waiting on an auth rung for its own icon is a request nobody meant to authorize.
//
// A directory READ at boot rather than a stat per request. An app's public directory is small, fixed
// for the life of a process, and the alternative is a filesystem call on the miss path of every
// request that is not a public file — which is nearly all of them.

import { PUBLIC_DIR } from '#compiler/LAYOUT.ts'
import { NOSNIFF } from './assets.ts'

type BunFile = ReturnType<typeof Bun.file>

/**
 * How long a browser may keep a public file without asking.
 *
 * An hour, where a hashed chunk gets a year: the address does not change when the bytes do, so the
 * only thing keeping a stale favicon off a screen is this number running out. `must-revalidate` so a
 * cache that has held one past the hour asks rather than serving it while it refreshes.
 */
const BRIEFLY = 'public, max-age=3600, must-revalidate'

/** The files, by the path they answer at — `/favicon.ico`, `/images/hero.png`. */
export class PublicFiles {
    private readonly held: Map<string, BunFile>
    /** How many, for the boot report — the one line that says the convention is being read at all. */
    readonly count: number

    constructor(held: Map<string, BunFile>) {
        this.held = held
        this.count = held.size
    }

    /** The file at this request's path, or `undefined` for anything this directory does not hold. */
    serve(request: Request): Response | undefined {
        const file = this.held.get(new URL(request.url).pathname)
        if (file === undefined) return undefined
        // The headers are built per response rather than held beside the file: a `Headers` is mutable
        // and handing the same instance to two responses lets a middleware downstream of one edit the
        // other's. The type comes off the extension, which is what `Bun.file` already decided.
        return new Response(file, {
            headers: { 'content-type': file.type, 'cache-control': BRIEFLY, 'x-content-type-options': NOSNIFF },
        })
    }
}

/**
 * Everything under an app's public directory, ready to serve — or `null` for an app with none.
 *
 * `null` rather than an empty map, for the reason the page layer answers `null`: an app without the
 * directory should not pay a map lookup per request for a layer it does not have, and `assemble`
 * composes the two shapes once at boot rather than testing per request.
 *
 * A leading `/` and the path from the directory, so a name is the address: `public/favicon.ico`
 * answers at `/favicon.ico`, and a nested `public/images/hero.png` at `/images/hero.png`. Nothing is
 * URL-decoded on the way in, so a name with a space in it is looked up as `%20` — which is what the
 * browser will actually ask for.
 */
export async function publicFiles(root: string): Promise<PublicFiles | null> {
    const directory = `${root}/${PUBLIC_DIR}`
    try {
        if (!(await Bun.file(directory).stat()).isDirectory()) return null
    } catch {
        return null
    }
    const held = new Map<string, BunFile>()
    const glob = new Bun.Glob('**/*')
    for await (const found of glob.scan({ cwd: directory, absolute: false, onlyFiles: true })) {
        held.set(`/${found}`, Bun.file(`${directory}/${found}`))
    }
    return held.size === 0 ? null : new PublicFiles(held)
}
