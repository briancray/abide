// Tests for `abide check` (C10) — the best-effort `.abide` script type-checker.
//
// Each fixture is a real on-disk mini-project (its own tsconfig) so the TS7 pass resolves a project
// and imports exactly as it would for a real app. We assert: (a) a script with genuine type errors is
// reported with codes + `.abide`-mapped lines, and (b) a clean script passes.

import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { check } from './check.ts'

const TSCONFIG = JSON.stringify({
    compilerOptions: {
        lib: ['ESNext', 'DOM'],
        target: 'ESNext',
        module: 'Preserve',
        moduleResolution: 'bundler',
        moduleDetection: 'force',
        allowImportingTsExtensions: true,
        noEmit: true,
        strict: true,
        skipLibCheck: true,
        types: [],
    },
    include: ['src/**/*.ts'],
})

const cleanupDirs: string[] = []
afterEach(() => {
    for (const dir of cleanupDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

async function makeProject(files: Record<string, string>): Promise<string> {
    const root = mkdtempSync(join(tmpdir(), 'abide-check-'))
    cleanupDirs.push(root)
    await Bun.write(join(root, 'tsconfig.json'), TSCONFIG)
    for (const [relative, content] of Object.entries(files)) {
        await Bun.write(join(root, relative), content)
    }
    return root
}

test('reports type errors in a .abide script, mapped back to the .abide file', async () => {
    const badPage =
        '<script>\n' + // 1
        'import bogus from "./does-not-exist"\n' + // 2 -> unresolved import (TS2307)
        'const value = 123\n' + // 3
        'const oops = value.toUpperCase()\n' + // 4 -> number has no toUpperCase (TS2339)
        'const undef = missingIdentifier + 1\n' + // 5 -> undefined identifier (TS2304)
        '</script>\n' +
        '<p>{oops}{undef}{bogus}</p>\n'
    const root = await makeProject({ 'src/ui/pages/bad/page.abide': badPage })

    const result = await check(root)
    expect(result.ok).toBe(false)

    const badPath = join(root, 'src/ui/pages/bad/page.abide')
    for (const diagnostic of result.diagnostics) expect(diagnostic.file).toBe(badPath)

    const codes = result.diagnostics.map((diagnostic) => diagnostic.code)
    expect(codes).toContain(2307) // unresolved import
    expect(codes).toContain(2339) // wrong type usage
    expect(codes).toContain(2304) // undefined identifier

    // Line mapping: each diagnostic lands on its original `.abide` line.
    const importDiagnostic = result.diagnostics.find((diagnostic) => diagnostic.code === 2307)
    const usageDiagnostic = result.diagnostics.find((diagnostic) => diagnostic.code === 2339)
    const undefinedDiagnostic = result.diagnostics.find((diagnostic) => diagnostic.code === 2304)
    expect(importDiagnostic?.line).toBe(2)
    expect(usageDiagnostic?.line).toBe(4)
    expect(undefinedDiagnostic?.line).toBe(5)
})

test('passes a clean .abide script', async () => {
    const cleanPage =
        '<script>\n' +
        'const greeting = "hello"\n' +
        'const upper = greeting.toUpperCase()\n' +
        'let counter = 0\n' +
        'function bump() { counter = counter + 1 }\n' +
        '</script>\n' +
        '<h1>{upper}</h1>\n' +
        '<button onclick={bump}>{counter}</button>\n'
    const root = await makeProject({ 'src/ui/pages/page.abide': cleanPage })

    const result = await check(root)
    expect(result.diagnostics).toEqual([])
    expect(result.ok).toBe(true)
})

test('a page with no <script> is skipped (no diagnostics)', async () => {
    const root = await makeProject({ 'src/ui/pages/static/page.abide': '<h1>static</h1>\n' })
    const result = await check(root)
    expect(result.ok).toBe(true)
    expect(result.diagnostics).toEqual([])
})

// A `StateCell`-shaped factory (matched structurally by the checker's `__abideUnwrap`) stands in for
// `abide/ui/state`, so these exercise the real type engine without a workspace-resolution dependency.
const CELL_MODULE =
    'export interface Cell<T> { read(): T; write(v: T): void; peek(): T }\n' +
    'export function state<T>(initial: T): Cell<T> {\n' +
    '  return { read: () => initial, write: () => {}, peek: () => initial }\n' +
    '}\n'

test('state vars type as their value: concrete inits keep inference, empty/nullish inits stay usable', async () => {
    const page =
        '<script>\n' +
        "import { state } from '../../cell.ts'\n" +
        'let count = state(0)\n' + // inferred number
        'let items = state([])\n' + // widened -> any[]
        'let picks: number[] = state([])\n' + // annotated
        'let sel = state(null)\n' + // widened -> any
        'count = count + 1\n' +
        'items.push(1)\n' +
        'picks.push(2)\n' +
        'sel = { anything: true }\n' +
        '</script>\n' +
        '<p>{count.toFixed(2)}</p>\n'
    const root = await makeProject({
        'src/ui/cell.ts': CELL_MODULE,
        'src/ui/pages/ok/page.abide': page,
    })
    const result = await check(root)
    expect(result.diagnostics).toEqual([])
    expect(result.ok).toBe(true)
})

test('an inferred state var is checked against its value type (number has no toUpperCase)', async () => {
    const page =
        '<script>\n' +
        "import { state } from '../../cell.ts'\n" +
        'let count = state(0)\n' +
        'const bad = count.toUpperCase()\n' + // 4 -> number has no toUpperCase
        '</script>\n' +
        '<p>{bad}</p>\n'
    const root = await makeProject({
        'src/ui/cell.ts': CELL_MODULE,
        'src/ui/pages/bad/page.abide': page,
    })
    const result = await check(root)
    expect(result.ok).toBe(false)
    const usage = result.diagnostics.find((diagnostic) => diagnostic.code === 2339)
    expect(usage?.line).toBe(4)
})
