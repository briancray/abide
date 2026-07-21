// TYPE-ONLY IMPORTS in a `.abide` <script> are ERASED from the runtime emit (analyzeScope.parseImport).
// A value import becomes `const x = $scope["x"]`; a `{ type X }` modifier or a whole-clause `import type`
// must NOT — otherwise the runtime emits `const type X = $scope["type X"]` (a syntax error) or aliases a
// type name that is `undefined` at runtime. The type stays resolvable for `abide check` (emitCheck copies
// the raw script verbatim); only the runtime path drops it.

import { expect, test } from 'bun:test'
import { emitModuleSource } from './emit.ts'

function emit(script: string): string {
    const { server, client } = emitModuleSource(`<script>${script}</script><p>{value}</p>`)
    return `${server}\n${client}`
}

test('a per-specifier `{ type X }` modifier is dropped; the value import is aliased', () => {
    const out = emit(
        `import value, { type Shape } from "../server/rpc/value.ts"\n  const x: Shape = value`,
    )
    expect(out).toContain('$scope["value"]')
    // The type modifier never becomes a scope alias.
    expect(out).not.toContain('type Shape')
    expect(out).not.toContain('$scope["Shape"]')
})

test('a whole-clause `import type { X }` is fully erased (no scope alias)', () => {
    const out = emit(`import type { Shape } from "../server/rpc/value.ts"\n  let value = 1`)
    expect(out).not.toContain('$scope["Shape"]')
    expect(out).not.toContain('const type')
})

test('`{ type as foo }` keeps the value binding named `type` aliased to `foo`', () => {
    const out = emit(`import { type as foo } from "../server/rpc/value.ts"\n  const y = foo`)
    // `type as foo` is the value export `type` aliased — NOT a modifier — so `foo` is a real binding.
    expect(out).toContain('$scope["foo"]')
})

test('mixed value + type named imports keep only the value binding', () => {
    const out = emit(
        `import { live, type Shape, other } from "../server/rpc/value.ts"\n  const a = live; const b = other`,
    )
    expect(out).toContain('$scope["live"]')
    expect(out).toContain('$scope["other"]')
    expect(out).not.toContain('$scope["Shape"]')
})
