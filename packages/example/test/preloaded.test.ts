// The preload list is written TWICE, and this is what keeps the two copies saying the same thing.
//
// A bunfig SHADOWS rather than merges: bun reads the one in the directory it was invoked from and no
// other. This package has its own for `[serve.static] plugins` — Tailwind, an example dependency the
// framework must not acquire — and that file existing at all is what took the DOM and the `.abide`
// loader away from a `bun test` typed inside the package. What it looked like was 19 failures reading
// `document is not defined` and `has no default export`, not one of which names the cause.
//
// So the root's `[test] preload` is repeated here, and a repetition that can drift is one a gate owes
// a check to.

import { expect, test } from 'bun:test'
import { resolve } from 'node:path'

const APP = new URL('../', import.meta.url).pathname
const ROOT = new URL('../../../', import.meta.url).pathname

/**
 * A bunfig's `[test] preload`, as absolute paths.
 *
 * Read as TEXT rather than through a TOML parser: the two lists are written relative to their own
 * files — `./packages/abide-kit/…` at the root and `../abide-kit/…` here — so what is being compared
 * is what they RESOLVE to, and a parser would hand back the strings this still has to resolve.
 */
async function preloaded(dir: string): Promise<string[]> {
    const text = await Bun.file(`${dir}bunfig.toml`).text()
    const list = /\[test\][\s\S]*?preload\s*=\s*\[([^\]]*)\]/.exec(text)?.[1] ?? ''
    const paths: string[] = []
    for (const piece of list.split(',')) {
        const named = piece.trim().replace(/^["']|["']$/g, '')
        if (named !== '') paths.push(resolve(dir, named))
    }
    return paths
}

test('both bunfigs preload the same files, in the same order', async () => {
    const app = await preloaded(APP)
    // Non-empty as its own claim: a regex that matched nothing would make two missing sections equal,
    // which is the one way this passes while preloading nothing at all.
    expect(app.length).toBe(2)
    expect(app).toEqual(await preloaded(ROOT))
})

test('and every file either of them names is on disk', async () => {
    for (const path of await preloaded(APP)) {
        expect(await Bun.file(path).exists(), `${path} is preloaded and does not exist`).toBe(true)
    }
})

test('the DOM the preload installs is here, whichever directory this was run from', () => {
    // The symptom of its absence, and the reason it is asserted rather than assumed: without it the
    // ui suites fail thirteen times over on `document is not defined`, and the kit's own cases go on
    // passing while measuring a different code path.
    expect(typeof document).toBe('object')
    expect(document.createElement('div').isConnected).toBe(false)
})
