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
    expect(
        (await closureText(out, 'stored/index.abide')).includes(WEB_STORE),
    ).toBe(true)
    // 8.22 — nor a store the page does not import.
    expect(light.includes(WEB_STORE)).toBe(false)
}, 60_000)

// Names each `observe` adaptor's module reads off the platform, which survive minification: the
// border box is `size`'s alone, `isIntersecting` `visible`'s, and `rootMargin` `rect`'s.
const SIZE_OBSERVER = 'borderBoxSize'
const VISIBLE_OBSERVER = 'isIntersecting'
const RECT_OBSERVER = 'rootMargin'

// THE REVERT: have `observe/index.ts` bind the three as `const`s of its own rather than re-export
// them, and the size page loads `visible`'s and `rect`'s observers with its own — `isIntersecting`
// and `rootMargin` both found. Re-exported, `export * as observe` keeps only the member read.
test('a page using observe.size loads neither observe.visible nor observe.rect — 38.94', async () => {
    const app = appFixture({
        'index.abide': `<script>
import { reactive } from '@abide/abide'

let count = reactive(0)
</script>

<button onclick={() => { count = count + 1 }}>{count}</button>`,
        'sized/index.abide': `<script>
import { observe, reactive } from '@abide/abide'

let box = reactive({ width: 0, height: 0 })
</script>

<div bind:element={observe.size(box, { box: 'border' })}>{box.width}</div>`,
        'all/index.abide': `<script>
import { observe, reactive } from '@abide/abide'

let seen = reactive(false)
let placed = reactive<{ x: number }>()
</script>

<div bind:element={[observe.visible(seen), observe.rect(placed)]}>{seen}</div>`,
    })
    const out = `${app}/.abide`
    const built = await buildApp(app)
    expect(built.exitCode, built.stderr).toBe(0)
    const all = await closureText(out, 'all/index.abide')
    expect(all.includes(VISIBLE_OBSERVER)).toBe(true)
    expect(all.includes(RECT_OBSERVER)).toBe(true)
    const sized = await closureText(out, 'sized/index.abide')
    expect(sized.includes(SIZE_OBSERVER)).toBe(true)
    expect(sized.includes(VISIBLE_OBSERVER)).toBe(false)
    expect(sized.includes(RECT_OBSERVER)).toBe(false)
    const light = await closureText(out, 'index.abide')
    expect(light.includes(SIZE_OBSERVER)).toBe(false)
    expect(light.includes(VISIBLE_OBSERVER)).toBe(false)
    expect(light.includes(RECT_OBSERVER)).toBe(false)
}, 60_000)
