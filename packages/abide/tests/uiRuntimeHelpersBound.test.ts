import { describe, expect, test } from 'bun:test'
import { assertRuntimeHelpersBound } from '../src/lib/ui/compile/assertRuntimeHelpersBound.ts'

/*
The compile-time backstop that turns a dropped runtime import (a helper called but never
imported → `ReferenceError` at mount → the router's reload loop) into a located compile
error. It is independent of the dead-import filter it guards: it asks "is every called
helper bound?" by walking the final module's AST, so it catches the filter undercounting.
*/
describe('assertRuntimeHelpersBound', () => {
    test('throws when a called helper is neither imported nor declared', () => {
        const broken = `import { mount } from '@abide/abide/ui/dom/mount'
function build(host) {
    effect(() => host.textContent = 'x')
}
export default function component(host) { return mount(host, build) }`
        expect(() => assertRuntimeHelpersBound(broken, 'test')).toThrow(/\beffect\b/)
    })

    test('passes when every called helper is imported', () => {
        const ok = `import { mount } from '@abide/abide/ui/dom/mount'
import { effect } from '@abide/abide/ui/effect'
function build(host) {
    effect(() => host.textContent = 'x')
}
export default function component(host) { return mount(host, build) }`
        expect(() => assertRuntimeHelpersBound(ok, 'test')).not.toThrow()
    })

    test('a helper name quoted inside a string snippet is not a call — no false alarm', () => {
        /* A docs component renders framework code as text; `mount(` appears in a template
           literal, not as a real call, so it must not demand an import. */
        const docs = `import { appendText } from '@abide/abide/ui/dom/appendText'
function build(host) {
    appendText(host, () => \`call mount(host, build) to start\`)
}`
        expect(() => assertRuntimeHelpersBound(docs, 'test')).not.toThrow()
    })

    test('a locally declared name shadowing a helper satisfies its call', () => {
        const shadowed = `function build(host) {
    const effect = (fn) => fn()
    effect(() => host.textContent = 'x')
}`
        expect(() => assertRuntimeHelpersBound(shadowed, 'test')).not.toThrow()
    })
})
