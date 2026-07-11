import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { devClientFingerprint } from '../src/lib/server/runtime/devClientFingerprint.ts'

let dir: string | undefined

afterEach(() => {
    if (dir) {
        rmSync(dir, { recursive: true, force: true })
        dir = undefined
    }
})

const SHELL = '<html><head><link rel="stylesheet" href="/_app/client-v1.css" /></head></html>'
const LEAF = `<script>import { state } from '@abide/abide/ui/state'
let n = state(0)</script>\n<button on:click={n++}>{n}</button><style>button{color:red}</style>`

/* A throwaway project tree the stamp can scan: a component, a page, and a plain
   source file. tsconfig at the root makes the component module ids project-relative
   (`src/…`). */
async function makeTree(): Promise<{ srcDir: string; publicDir: string; projectRoot: string }> {
    dir = mkdtempSync(`${tmpdir()}/abide-stamp-`)
    mkdirSync(`${dir}/src/ui/pages`, { recursive: true })
    mkdirSync(`${dir}/src/server`, { recursive: true })
    mkdirSync(`${dir}/public`, { recursive: true })
    await Bun.write(`${dir}/tsconfig.json`, '{"compilerOptions":{}}')
    await Bun.write(`${dir}/src/Card.abide`, LEAF)
    await Bun.write(`${dir}/src/ui/pages/page.abide`, '<h1>home</h1>')
    await Bun.write(`${dir}/src/server/thing.ts`, 'export const x = 1')
    await Bun.write(`${dir}/public/logo.png`, 'png')
    return { srcDir: `${dir}/src`, publicDir: `${dir}/public`, projectRoot: dir }
}

const stampOf = (tree: { srcDir: string; publicDir: string; projectRoot: string }, shell = SHELL) =>
    devClientFingerprint({ ...tree, shell })

describe('devClientFingerprint', () => {
    test('the stamp is just structure + cssHref — no per-component hot map', async () => {
        const tree = await makeTree()
        const stamp = await stampOf(tree)
        expect(typeof stamp.structure).toBe('string')
        expect(stamp.cssHref).toBe('/_app/client-v1.css')
        expect('components' in stamp).toBe(false)
    })

    test('editing a component reloads: its body folds into structure', async () => {
        const tree = await makeTree()
        const before = await stampOf(tree)
        await Bun.write(`${tree.srcDir}/Card.abide`, LEAF.replace('{n}', 'count {n}'))
        const after = await stampOf(tree)
        expect(after.structure).not.toBe(before.structure)
    })

    test("a component's style-only edit leaves structure stable (no reload)", async () => {
        const tree = await makeTree()
        const before = await stampOf(tree)
        // The body is hashed via compileComponent, which carries no CSS — so a style edit
        // doesn't move structure; the CSS restyle rides cssHref instead.
        await Bun.write(`${tree.srcDir}/Card.abide`, LEAF.replace('color:red', 'color:blue'))
        const after = await stampOf(tree)
        expect(after.structure).toBe(before.structure)
    })

    test('editing a page reloads: it folds into structure', async () => {
        const tree = await makeTree()
        const before = await stampOf(tree)
        await Bun.write(`${tree.srcDir}/ui/pages/page.abide`, '<h1>changed</h1>')
        const after = await stampOf(tree)
        expect(after.structure).not.toBe(before.structure)
    })

    test('editing a non-component source file changes structure', async () => {
        const tree = await makeTree()
        const before = await stampOf(tree)
        await Bun.write(`${tree.srcDir}/server/thing.ts`, 'export const x = 2')
        const after = await stampOf(tree)
        expect(after.structure).not.toBe(before.structure)
    })

    test('adding a component changes structure (the component-id set)', async () => {
        const tree = await makeTree()
        const before = await stampOf(tree)
        await Bun.write(`${tree.srcDir}/Badge.abide`, '<span>b</span>')
        const after = await stampOf(tree)
        expect(after.structure).not.toBe(before.structure)
    })

    test('a CSS-only edit moves cssHref but leaves structure stable', async () => {
        const tree = await makeTree()
        const before = await stampOf(tree)
        const after = await stampOf(tree, SHELL.replace('client-v1.css', 'client-v2.css'))
        expect(after.structure).toBe(before.structure)
        expect(after.cssHref).toBe('/_app/client-v2.css')
    })
})
