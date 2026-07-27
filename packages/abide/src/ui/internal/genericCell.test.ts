// GENERIC cell/props call forms (`state<T>(...)`, `memo<T>(...)`, `props<T>()`) must be
// recognised by analyzeBindings so the read/write reference rewrite still fires — otherwise a
// `let n = state<number>(0)` is treated as a plain binding, `{n}` reads the cell object, and a spread
// (`[...n]`) throws "{} is not iterable" at runtime. Bare forms are unchanged; a `state < 5` comparison
// must NOT be misread as a cell.

import { expect, test } from 'bun:test'
import { emitModuleSource } from './emit.ts'

function emit(script: string, body: string): string {
    const { server, client } = emitModuleSource(`<script>${script}</script>${body}`)
    return `${server}\n${client}`
}

test('a generic `state<T>(...)` var is a cell — reads rewrite to `()`', () => {
    const out = emit(
        `import { state } from "abide/shared/state"\n  let n = state<number>(0)`,
        '<p>{n}</p>',
    )
    expect(out).toContain('n()')
})

test('a generic `state<T>(...)` var write rewrites to `.set()`', () => {
    const out = emit(
        `import { state } from "abide/shared/state"\n  let n = state<number>(0)\n  function bump() { n = 5 }`,
        '<p>{n}</p>',
    )
    expect(out).toContain('n.set(')
})

test('nested-generic `state<Array<number>>(...)` (no top-level comma) is still a cell', () => {
    // `callFollows` skips a balanced `<...>` incl. nested `>>`.
    const out = emit(
        `import { state } from "abide/shared/state"\n  let m = state<Array<number>>([])`,
        '<p>{m.length}</p>',
    )
    expect(out).toContain('m()')
})

// A type argument list with a TOP-LEVEL comma used to split the declarator mid-type, which both broke
// the binding and leaked the tail's type names into scope as fake module bindings (`{ room: string }>`
// read as a destructuring pattern → a `string` binding → ReferenceError on module init).
test('a top-level comma in a type argument list does not split the declarator', () => {
    const out = emit(
        `import { state } from "abide/shared/state"\n  let m = state<Map<string, number>>(new Map())`,
        '<p>{m.size}</p>',
    )
    expect(out).toContain('m()')
})

test('a two-parameter generic at module scope binds only the declared name', () => {
    const { client } = emitModuleSource(
        '<script module>\n' +
            'import { channel } from "abide/shared/channel"\n' +
            'const notes = channel<{ text: string }, { room: string }>({ tail: 3 })\n' +
            '</script><p>{notes.peek({ room: "a" })?.text}</p>',
    )
    expect(client).toContain('$module = { notes }')
    expect(client).toContain('const { notes } = $ensureModule($scope)')
})

test('a `<` comparison in a declarator list is not read as a type argument list', () => {
    const out = emit(
        `import { state } from "abide/shared/state"\n  let over = state(1 < 2), n = state(5)`,
        '<p>{over} {n}</p>',
    )
    expect(out).toContain('over()')
    expect(out).toContain('n()')
})

test('generic `memo<T>(...)` is recognised as an auto-called memo', () => {
    const out = emit(
        `import { memo } from "abide/shared/memo"\n  const d = memo<number>(() => 1)`,
        '<p>{d}</p>',
    )
    expect(out).toContain('d()')
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
        `import { state } from "abide/shared/state"\n  let flag = state < 5`,
        '<p>{flag}</p>',
    )
    // `flag` is a plain boolean binding, not a cell — no `()` rewrite on it.
    expect(out).not.toContain('flag()')
})
