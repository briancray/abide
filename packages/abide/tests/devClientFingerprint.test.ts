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

/* A throwaway project tree the stamp can scan: a leaf component (hot-swappable), a
   page (router-mounted → folds into structure), and a plain source file. tsconfig
   at the root makes the component module ids project-relative (`src/…`). */
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
    test('a leaf component is hot-swappable: keyed in components, not structure', async () => {
        const tree = await makeTree()
        const stamp = await stampOf(tree)
        expect(Object.keys(stamp.components)).toEqual(['src/Card.abide'])
        expect(stamp.cssHref).toBe('/_app/client-v1.css')
    })

    test('editing a leaf component moves its hash, leaves structure stable (no reload)', async () => {
        const tree = await makeTree()
        const before = await stampOf(tree)
        await Bun.write(`${tree.srcDir}/Card.abide`, LEAF.replace('{n}', 'count {n}'))
        const after = await stampOf(tree)
        expect(after.structure).toBe(before.structure)
        expect(after.components['src/Card.abide']).not.toBe(before.components['src/Card.abide'])
    })

    test("a component's style-only edit changes neither structure nor its hash", async () => {
        const tree = await makeTree()
        const before = await stampOf(tree)
        await Bun.write(`${tree.srcDir}/Card.abide`, LEAF.replace('color:red', 'color:blue'))
        const after = await stampOf(tree)
        expect(after.structure).toBe(before.structure)
        expect(after.components['src/Card.abide']).toBe(before.components['src/Card.abide'])
    })

    test('editing a page reloads: it folds into structure, not components', async () => {
        const tree = await makeTree()
        const before = await stampOf(tree)
        await Bun.write(`${tree.srcDir}/ui/pages/page.abide`, '<h1>changed</h1>')
        const after = await stampOf(tree)
        expect(after.structure).not.toBe(before.structure)
        expect(after.components).toEqual(before.components)
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

    test('an import-bearing component is not hot-swappable', async () => {
        const tree = await makeTree()
        await Bun.write(
            `${tree.srcDir}/Parent.abide`,
            "<script>import Card from './Card.abide'</script>\n<Card/>",
        )
        const stamp = await stampOf(tree)
        expect(stamp.components['src/Parent.abide']).toBeUndefined()
    })

    test('a CSS-only edit moves cssHref but leaves structure stable', async () => {
        const tree = await makeTree()
        const before = await stampOf(tree)
        const after = await stampOf(tree, SHELL.replace('client-v1.css', 'client-v2.css'))
        expect(after.structure).toBe(before.structure)
        expect(after.cssHref).toBe('/_app/client-v2.css')
    })
})
