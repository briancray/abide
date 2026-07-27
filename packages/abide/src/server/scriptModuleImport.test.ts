// AN ORDINARY IMPORT IN A `<script>` IS AN ORDINARY IMPORT.
//
// A `.abide` script can import a plain module — a relative `.ts`, a tsconfig alias, a package — and it
// is bundled on the client and resolved on the server like any other ES import. No allowlist to be on.
//
// It was not always so: only `abide/shared|ui/*` passed through, and every other specifier fell back to
// a `$scope` read. That read is how the two families that genuinely need it are wired — scope-provided
// primitives (`state`, `props`, …) and `$server/*` modules (SSR binds the real callable, the browser a
// proxy) — but it was also the silent default for everything else, so an ordinary import compiled clean
// and arrived `undefined` at mount. These tests pin the behaviour on both sides, and pin the loud
// failure that replaced the silent one.

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildClient } from '../server/internal/clientBundle.ts'
import type { AppConfig } from '../server/internal/router.ts'
import { createTestApp } from '../test/createTestApp.ts'

let fixtureDir: string

// A plain module on disk — not a component, not an RPC, not framework surface. Just a module.
const HELPER = `export const LABEL = 'FROM_PLAIN_MODULE'\nexport function shout(s) { return s + '!' }\n`

// The page imports it relatively and uses both bindings in the template.
const PAGE =
    `<script>import { LABEL, shout } from "./helper.ts"</script>` +
    `<p>{LABEL}</p><p>{shout("loud")}</p>`

function config(): AppConfig {
    return { routes: {}, pages: { '/': PAGE }, pageDirs: { '/': fixtureDir } }
}

beforeAll(async () => {
    fixtureDir = await mkdtemp(join(tmpdir(), 'abide-import-fixture-'))
    await writeFile(join(fixtureDir, 'helper.ts'), HELPER)
})

afterAll(async () => {
    await rm(fixtureDir, { recursive: true, force: true })
})

test('SSR: a plain module imported by a <script> resolves and renders', async () => {
    const app = await createTestApp(config())
    const response = await app.fetch('/')
    expect(response.status).toBe(200)
    const body = await response.text()

    // The value came from the imported module, so the SSR emit resolved it from the page's own dir —
    // the compiled module is written into abide's internal dir, where "./helper.ts" means nothing.
    expect(body).toContain('FROM_PLAIN_MODULE')
    expect(body).toContain('loud!')

    await app.stop()
})

test('client build: the module is BUNDLED, not read off $scope', async () => {
    const build = await buildClient(config())
    let js = ''
    const decoder = new TextDecoder()
    for (const [name, asset] of build.files)
        if (name.endsWith('.js')) js += `${decoder.decode(asset.identity)}\n`

    // The module's own source rode into the bundle — Bun.build followed the rewritten specifier.
    expect(js).toContain('FROM_PLAIN_MODULE')
    // …and the locals resolve lexically. A `$scope` read for either of them is the old fallback, which
    // is precisely the bug: it builds clean and is `undefined` when the template calls it.
    expect(js).not.toContain('$scope["shout"]')
    expect(js).not.toContain('$scope["LABEL"]')
})

test('an unresolvable import fails the BUILD, naming the specifier', async () => {
    const broken: AppConfig = {
        routes: {},
        pages: { '/': `<script>import { nope } from "./not-here.ts"</script><p>{nope}</p>` },
        pageDirs: { '/': fixtureDir },
    }
    // Loud at build time rather than `undefined` at mount — the same contract the socket reachability
    // check keeps. The message names the specifier so the fix is obvious.
    expect(buildClient(broken)).rejects.toThrow(/not-here\.ts/)
})
