// 38.94 — A PAGE LOADS WHAT IT USES. The `@abide/abide` barrel names every export, and a page that
// imports one of them through it must not load the modules behind the rest.

import { afterAll, expect, test } from 'bun:test'

import { buildFiles } from '#server/appBuild.ts'

import { appFixture, buildApp } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

afterAll(removeTemporaryModules)

// A string `validateJson` throws with: a literal survives minification where a name does not.
const SCHEMA_VALIDATOR = 'does not implement the JSON Schema keyword'
const IMAGE_DRAWER = 'could not be drawn as one a model is shown'
// And one `webStore` reaches through `storedValue` (8.22): a store a page does not import costs it nothing.
const WEB_STORE = 'holds something no abide store wrote'

// The static closure a page's document loads — the entry, then each chunk the manifest names for
// the page, and every chunk those import.
async function closureText(out: string, page: string): Promise<string> {
    const manifest = (await Bun.file(buildFiles(out).manifest).json()) as {
        entry: string
        chunks: Record<string, string[]>
    }
    const seen = new Set<string>()
    let text = ''
    const pending = [manifest.entry, ...(manifest.chunks[page] ?? [])]
    while (pending.length > 0) {
        const name = pending.pop() as string
        if (seen.has(name)) continue
        seen.add(name)
        const source = await Bun.file(`${out}/client/${name}`).text()
        text += source
        for (const imported of source.matchAll(
            /(?:from|import)\s*"\.\/([\w-]+\.js)"/g,
        ))
            pending.push(imported[1] as string)
    }
    return text
}

// THE REVERT: drop `sideEffects` from the package's `package.json` and the light page loads the
// schema validator — and the rest of the barrel with it, 20.2 KB brotli become 25.8.
test('a page loads the modules it uses and not the barrel’s rest — 38.94', async () => {
    const app = appFixture({
        'index.abide': `<script>
import { reactive } from '@abide/abide'

let count = reactive(0)
</script>

<button onclick={() => { count = count + 1 }}>{count}</button>`,
        'schema/index.abide': `<script>
import { imagePiece, reactive, validateJson } from '@abide/abide'

let count = reactive(0)
</script>

<p onclick={() => imagePiece(new Blob())}>{String(validateJson({ type: 'number' }, count) === null)}</p>`,
        'stored/index.abide': `<script>
import { reactive, webStore } from '@abide/abide'

let count = reactive(0, { store: webStore('count') })
</script>

<button onclick={() => { count = count + 1 }}>{count}</button>`,
    })
    const out = `${app}/.abide`
    const built = await buildApp(app)
    expect(built.exitCode, built.stderr).toBe(0)
    // The positive case first: the validator is in the build, so its absence below is the split.
    const heavy = await closureText(out, 'schema/index.abide')
    expect(heavy.includes(SCHEMA_VALIDATOR)).toBe(true)
    expect(heavy.includes(IMAGE_DRAWER)).toBe(true)
    const light = await closureText(out, 'index.abide')
    expect(light.includes(SCHEMA_VALIDATOR)).toBe(false)
    // 44.52 — nor the image a turn is pasted with, which only a chat panel draws.
    expect(light.includes(IMAGE_DRAWER)).toBe(false)
    expect((await closureText(out, 'stored/index.abide')).includes(WEB_STORE)).toBe(true)
    // 8.22 — nor a store the page does not import.
    expect(light.includes(WEB_STORE)).toBe(false)
}, 60_000)
