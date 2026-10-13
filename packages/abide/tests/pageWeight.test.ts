// 38.94 — A PAGE LOADS WHAT IT USES. The `@abide/abide` barrel names every export, and a page that
// imports one of them through it must not load the modules behind the rest.

import { afterAll, expect, test } from 'bun:test'
import { appFixture, buildApp } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

afterAll(removeTemporaryModules)

// A string `validateJson` throws with: a literal survives minification where a name does not.
const SCHEMA_VALIDATOR = 'does not implement the JSON Schema keyword'

// The static closure a page's document loads — the entry, then each chunk the manifest names for
// the page, and every chunk those import.
async function closureText(out: string, page: string): Promise<string> {
    const manifest = (await Bun.file(`${out}/manifest.json`).json()) as {
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
        'page.abide': `<script>
import { reactive } from '@abide/abide'

let count = reactive(0)
</script>

<button onclick={() => { count = count + 1 }}>{count}</button>`,
        'schema/page.abide': `<script>
import { reactive, validateJson } from '@abide/abide'

let count = reactive(0)
</script>

<p>{String(validateJson({ type: 'number' }, count) === null)}</p>`,
    })
    const out = `${app}/.abide`
    const built = await buildApp(app)
    expect(built.exitCode, built.stderr).toBe(0)
    // The positive case first: the validator is in the build, so its absence below is the split.
    expect(
        (await closureText(out, 'schema/page.abide')).includes(
            SCHEMA_VALIDATOR,
        ),
    ).toBe(true)
    expect(
        (await closureText(out, 'page.abide')).includes(
            SCHEMA_VALIDATOR,
        ),
    ).toBe(false)
}, 60_000)
