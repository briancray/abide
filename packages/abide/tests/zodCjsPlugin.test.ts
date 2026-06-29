import { describe, expect, test } from 'bun:test'
import type { OnResolveArgs, PluginBuilder } from 'bun'
import { zodCjsPlugin } from '../src/zodCjsPlugin.ts'

/* Repo root — zod is hoisted there by the workspace, so it resolves. */
const repoRoot = new URL('../../..', import.meta.url).pathname

/* Drives the plugin's setup to capture the single onResolve (filter + callback). */
function capture() {
    let filter: RegExp | undefined
    let callback: ((args: OnResolveArgs) => { path: string } | undefined) | undefined
    zodCjsPlugin(repoRoot).setup({
        onResolve: (options: { filter: RegExp }, cb: typeof callback) => {
            filter = options.filter
            callback = cb
        },
    } as unknown as PluginBuilder)
    if (!filter || !callback) {
        throw new Error('plugin did not register onResolve')
    }
    return { filter, callback }
}

/*
The fix for bun#31586: zod must bundle as CommonJS in server output. The plugin
matches every zod specifier and rewrites it to zod's `.cjs` sibling.
*/
describe('zodCjsPlugin', () => {
    test('matches zod and its subpaths, not lookalikes', () => {
        const { filter } = capture()
        expect(filter.test('zod')).toBe(true)
        expect(filter.test('zod/v4/core')).toBe(true)
        expect(filter.test('zodiac')).toBe(false)
    })

    test('rewrites a zod import to its .cjs build', () => {
        const { callback } = capture()
        const result = callback({ path: 'zod', importer: '' } as OnResolveArgs)
        expect(result?.path.endsWith('.cjs')).toBe(true)
        expect(result?.path).toContain('zod')
    })
})
