// The preload list is written once per package, and this is what keeps every copy saying the same
// thing.
//
// A bunfig SHADOWS rather than merges: bun reads the one in the directory it was invoked from and no
// other, and it does not walk up. So a `bun test` typed inside a package gets whatever that package
// declares — or nothing, which is how `packages/dogfood` produced 19 failures reading `document is not
// defined` and `.abide` pages reporting no default export, and how `packages/perf` lost six of eight.
//
// Worse than either is the case that does not fail: without the DOM the harness's own cases go on PASSING
// while measuring a code path the repo never ships. That is the failure CLAUDE.md names and no count
// reports, and it is why the rule is EVERY package holding a `*.test.ts` rather than the ones that
// happen to need a document this week.
//
// Four copies of a two-line list, taken deliberately. The alternatives are a preload barrel — a module
// whose whole job is to be two imports — or leaving a trap whose symptom points anywhere but at it. A
// repetition that can drift owes a gate; this is the gate.

import { expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { REPO_ROOT } from '#tests/PATHS.ts'

const ROOT = REPO_ROOT

/**
 * A bunfig's `[test] preload`, as absolute paths.
 *
 * Read as TEXT rather than through a TOML parser: each list is written relative to its OWN file —
 * `./packages/harness/…` at the root, `../bench/…` in a package — so what is compared is what
 * they RESOLVE to, which is the only sense in which two of them can be the same list.
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

/** Every package holding at least one test file — the packages this rule is ABOUT. */
async function packagesWithTests(): Promise<string[]> {
    const names = new Set<string>()
    for await (const found of new Bun.Glob('packages/*/**/*.test.ts').scan({ cwd: ROOT })) {
        names.add(found.split('/')[1] as string)
    }
    return [...names].sort()
}

test('every package holding a test declares the preload, and declares the same one', async () => {
    const root = await preloaded(ROOT)
    // Non-empty as its own claim: a regex that matched nothing would make two ABSENT sections equal,
    // which is the one way this passes while preloading nothing at all.
    expect(root.length).toBe(2)

    const packages = await packagesWithTests()
    // The list itself, so a package that stops carrying tests is a line to read rather than a silent
    // shrink — and so a glob that matched nothing cannot pass this by asserting over an empty loop.
    expect(packages).toEqual(['abide', 'dogfood', 'harness', 'perf'])

    for (const name of packages) {
        const at = `${ROOT}packages/${name}/`
        const declared = await Bun.file(`${at}bunfig.toml`).exists()
        expect(declared, `packages/${name} has tests and no bunfig`).toBe(true)
        expect(await preloaded(at), `packages/${name} preloads something else`).toEqual(root)
    }
})

test('every file any of them names is on disk', async () => {
    for (const path of await preloaded(ROOT)) {
        expect(await Bun.file(path).exists(), `${path} is preloaded and does not exist`).toBe(true)
    }
})

test('the DOM the preload installs is here, whichever directory this was run from', () => {
    expect(typeof document).toBe('object')
    expect(document.createElement('div').isConnected).toBe(false)
})
