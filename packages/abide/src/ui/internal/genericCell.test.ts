// GENERIC cell/props call forms (`state<T>(...)`, `state.computed<T>(...)`, `props<T>()`) must be
// recognised by analyzeScope so the read/write reference rewrite still fires — otherwise a
// `let n = state<number>(0)` is treated as a plain binding, `{n}` reads the cell object, and a spread
// (`[...n]`) throws "{} is not iterable" at runtime. Bare forms are unchanged; a `state < 5` comparison
// must NOT be misread as a cell.

import { expect, test } from 'bun:test'
import { emitModuleSource } from './emit.ts'

function emit(script: string, body: string): string {
    const { server, client } = emitModuleSource(`<script>${script}</script>${body}`)
    return `${server}\n${client}`
}

test('a generic `state<T>(...)` var is a cell — reads rewrite to `.read()`', () => {
    const out = emit(
        `import { state } from "abide/ui/state"\n  let n = state<number>(0)`,
        '<p>{n}</p>',
    )
    expect(out).toContain('n.read()')
})

test('a generic `state<T>(...)` var write rewrites to `.write()`', () => {
    const out = emit(
        `import { state } from "abide/ui/state"\n  let n = state<number>(0)\n  function bump() { n = 5 }`,
        '<p>{n}</p>',
    )
    expect(out).toContain('n.write(')
})

test('nested-generic `state<Array<number>>(...)` (no top-level comma) is still a cell', () => {
    // `callFollows` skips a balanced `<...>` incl. nested `>>`. NB: a generic type arg with a TOP-LEVEL
    // comma (`state<Map<K, V>>`) is NOT recognised — `splitTopLevelCommas` can't track `<>` (the
    // generic-vs-comparison ambiguity), so it splits on the comma. Use `Record`/`Array` or a cast there.
    const out = emit(
        `import { state } from "abide/ui/state"\n  let m = state<Array<number>>([])`,
        '<p>{m.length}</p>',
    )
    expect(out).toContain('m.read()')
})

test('generic `state.computed<T>(...)` is recognised as a computed cell', () => {
    const out = emit(
        `import { state } from "abide/ui/state"\n  let d = state.computed<number>(() => 1)`,
        '<p>{d}</p>',
    )
    expect(out).toContain('d.read()')
})

test('generic `props<T>()` is recognised (destructured prop reads as a local, not `$scope.title`)', () => {
    // `const { title } = props<{title: string}>()` — `props` resolves from `$scope` (a framework
    // binding, correct), and `title` reads as the destructured LOCAL, not a free `$scope.title`.
    const out = emit(
        `import { props } from "abide/ui/props"\n  const { title } = props<{ title: string }>()`,
        '<h1>{title}</h1>',
    )
    expect(out).toContain('const { title } = props<{ title: string }>()')
    expect(out).not.toContain('$scope.title')
    expect(out).not.toContain('$scope["title"]')
})

test('a `state < 5` comparison is NOT misread as a cell', () => {
    const out = emit(
        `import { state } from "abide/ui/state"\n  let flag = state < 5`,
        '<p>{flag}</p>',
    )
    // `flag` is a plain boolean binding, not a cell — no `.read()` rewrite on it.
    expect(out).not.toContain('flag.read()')
})
