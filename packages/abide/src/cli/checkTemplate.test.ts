// Tests for `abide check` TEMPLATE type-flow (C10.2–6, TODO #11 PR1) — the `emitCheck` lowering.
//
// Same on-disk fixture style as check.test.ts, but the errors live in TEMPLATE expressions (not the
// script): RPC/loop/await/narrowing/annotations. Asserts the diagnostic maps to the `.abide` template
// line and that clean templates + narrowing pass.

import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emitCheck } from '../ui/internal/emitCheck.ts'
import { parse } from '../ui/internal/parse.ts'
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
        noUnusedLocals: true,
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
    const root = mkdtempSync(join(tmpdir(), 'abide-check-tpl-'))
    cleanupDirs.push(root)
    await Bun.write(join(root, 'tsconfig.json'), TSCONFIG)
    for (const [relative, content] of Object.entries(files))
        await Bun.write(join(root, relative), content)
    return root
}

test('a type error in a template interpolation is caught and mapped to the template line', async () => {
    const page =
        '<script>\n' + // 1
        'const count = 5\n' + // 2  (number)
        '</script>\n' + // 3
        '<p>{count.toUpperCase()}</p>\n' // 4  number has no toUpperCase → TS2339 on line 4
    const root = await makeProject({ 'src/ui/pages/p/page.abide': page })
    const result = await check(root)
    expect(result.ok).toBe(false)
    const diag = result.diagnostics.find((d) => d.code === 2339)
    expect(diag).toBeDefined()
    if (!diag) throw new Error('expected a TS2339 diagnostic')
    expect(diag.line).toBe(4)
})

test('a `{#for}` loop variable is typed from the iterable', async () => {
    const page =
        '<script>\n' + // 1
        'const nums = [1, 2, 3]\n' + // 2  number[]
        '</script>\n' + // 3
        '<ul>{#for n of nums}<li>{n.toUpperCase()}</li>{/for}</ul>\n' // 4  n is number → error
    const root = await makeProject({ 'src/ui/pages/p/page.abide': page })
    const result = await check(root)
    expect(result.ok).toBe(false)
    expect(result.diagnostics.some((d) => d.code === 2339 && d.line === 4)).toBe(true)
})

test('a `{#await}` then-value is typed from the awaited promise', async () => {
    const page =
        '<script>\n' + // 1
        'async function load() { return 42 }\n' + // 2  Promise<number>
        '</script>\n' + // 3
        '<div>{#await load()}…{:then value}<b>{value.toUpperCase()}</b>{/await}</div>\n' // 4 value:number → error
    const root = await makeProject({ 'src/ui/pages/p/page.abide': page })
    const result = await check(root)
    expect(result.ok).toBe(false)
    expect(result.diagnostics.some((d) => d.code === 2339 && d.line === 4)).toBe(true)
})

test('control-flow narrowing in `{#if}` makes a valid template clean', async () => {
    const page =
        '<script>\n' +
        "const value: string | number = 'x'\n" +
        '</script>\n' +
        "<p>{#if typeof value === 'string'}{value.toUpperCase()}{:else}{value.toFixed(2)}{/if}</p>\n"
    const root = await makeProject({ 'src/ui/pages/p/page.abide': page })
    const result = await check(root)
    expect(result.diagnostics).toEqual([])
    expect(result.ok).toBe(true)
})

test('type annotations in template expressions type-check (verbatim copy)', async () => {
    const page =
        '<script>\n' +
        "const raw: unknown = 'hello'\n" +
        '</script>\n' +
        '<p>{(raw as string).toUpperCase()}</p>\n' // valid: annotation narrows unknown → string
    const root = await makeProject({ 'src/ui/pages/p/page.abide': page })
    const result = await check(root)
    expect(result.diagnostics).toEqual([])
    expect(result.ok).toBe(true)
})

// A local `props` shim so the mkdtemp project resolves it (no abide node_modules here); `deriveProps`
// reads the `props<T>()` type argument textually regardless.
const PROPS_SHIM = 'export function props<T = Record<string, unknown>>(): T { return {} as T }\n'

test('cross-file: a wrong-typed prop passed to a props<T>() component is caught', async () => {
    const files = {
        'src/lib/props.ts': PROPS_SHIM,
        'src/ui/components/Card.abide':
            "<script>import { props } from '../../lib/props.ts'\nconst { title = '', count = 0 } = props<{ title?: string; count?: number }>()</script><div>{title}{count}</div>\n",
        'src/ui/pages/p/page.abide':
            '<script>\nimport Card from \'../../components/Card.abide\'\n</script>\n<Card title="ok" count={"nope"} />\n', // 4: count expects number
    }
    const root = await makeProject(files)
    const result = await check(root)
    expect(result.ok).toBe(false)
    expect(
        result.diagnostics.some((d) => d.line === 4 && d.file.endsWith('pages/p/page.abide')),
    ).toBe(true)
})

// The props local is resolved from the IMPORT, not assumed to be spelled `props`. `componentDts` used
// to find the props type with `/\bprops\s*</` over raw source, with its own comment conceding "`props`
// assumed un-aliased" — so an aliased import fell through to the OPEN `Record<string, unknown>` and the
// component stopped being checked at every call site, silently. The build lane had resolved the local
// correctly the whole time; the check lane now reads its answer instead of guessing.
//
// This fixture imports the REAL `abide/ui/props` specifier (mapped to the shim through tsconfig
// `paths`, the way an app's own aliases resolve) because that specifier is what the resolution keys
// on — a relative shim import is not a props import to either lane.
test('cross-file: an ALIASED props import still closes the props type', async () => {
    const files = {
        'tsconfig.json': JSON.stringify({
            ...JSON.parse(TSCONFIG),
            compilerOptions: {
                ...JSON.parse(TSCONFIG).compilerOptions,
                baseUrl: '.',
                paths: { 'abide/ui/props': ['./src/lib/props.ts'] },
            },
        }),
        'src/lib/props.ts': PROPS_SHIM,
        'src/ui/components/Card.abide':
            "<script>import { props as p } from 'abide/ui/props'\nconst { title = '', count = 0 } = p<{ title?: string; count?: number }>()</script><div>{title}{count}</div>\n",
        'src/ui/pages/p/page.abide':
            '<script>\nimport Card from \'../../components/Card.abide\'\n</script>\n<Card title="ok" count={"nope"} />\n', // 4: count expects number
    }
    const root = await makeProject(files)
    const result = await check(root)
    expect(result.ok).toBe(false)
    expect(
        result.diagnostics.some((d) => d.line === 4 && d.file.endsWith('pages/p/page.abide')),
    ).toBe(true)
})

test('cross-file: an unknown prop on a closed props<T>() component is caught', async () => {
    const files = {
        'src/lib/props.ts': PROPS_SHIM,
        'src/ui/components/Card.abide':
            "<script>import { props } from '../../lib/props.ts'\nconst { title = '' } = props<{ title?: string }>()</script><div>{title}</div>\n",
        'src/ui/pages/p/page.abide':
            '<script>\nimport Card from \'../../components/Card.abide\'\n</script>\n<Card bogus="x" />\n', // 4: bogus not in props
    }
    const root = await makeProject(files)
    const result = await check(root)
    expect(result.diagnostics.some((d) => d.code === 2353 && d.line === 4)).toBe(true)
})

test('cross-file: valid props type-check clean; a bare props() component is open', async () => {
    const files = {
        'src/lib/props.ts': PROPS_SHIM,
        'src/ui/components/Card.abide':
            "<script>import { props } from '../../lib/props.ts'\nconst { title = '', count = 0 } = props<{ title?: string; count?: number }>()</script><div>{title}{count}</div>\n",
        'src/ui/components/Loose.abide':
            "<script>import { props } from '../../lib/props.ts'\nconst { name = '' } = props()</script><div>{name}</div>\n",
        'src/ui/pages/p/page.abide':
            '<script>\nimport Card from \'../../components/Card.abide\'\nimport Loose from \'../../components/Loose.abide\'\n</script>\n<Card title="hi" count={3} /><Loose name="x" anything={123} />\n',
    }
    const root = await makeProject(files)
    const result = await check(root)
    expect(result.diagnostics).toEqual([])
    expect(result.ok).toBe(true)
})

test('a Component<P>-typed prop is checked at the <Row .../> invoke site', async () => {
    const files = {
        'src/lib/props.ts': PROPS_SHIM,
        'src/ui/components/Menu.abide':
            "<script>import { props } from '../../lib/props.ts'\n" + // 1
            'const { Row } = props<{ Row: Component<{ entry: string }> }>()</script>\n' + // 2
            '<Row entry={123} />\n', // 3  entry:number not string → type error on line 3
    }
    const root = await makeProject(files)
    const result = await check(root)
    expect(result.ok).toBe(false)
    expect(result.diagnostics.some((d) => d.line === 3 && d.file.endsWith('Menu.abide'))).toBe(true)
})

test('a Component<P>-typed prop with correct props type-checks clean', async () => {
    const files = {
        'src/lib/props.ts': PROPS_SHIM,
        'src/ui/components/Menu.abide':
            "<script>import { props } from '../../lib/props.ts'\n" +
            'const { Row } = props<{ Row: Component<{ entry: string }> }>()</script>\n' +
            '<Row entry="hi" />\n',
    }
    const root = await makeProject(files)
    const result = await check(root)
    expect(result.diagnostics).toEqual([])
    expect(result.ok).toBe(true)
})

// The `.d.ts` companion carries no imports, so a props type naming an imported type is meant to degrade
// to `any`. It only degrades when TS cannot resolve the name — and the DOM lib declares `File`, `Event`,
// `Request`, `Text`, `Node`… so an owned name that collides was silently CHECKED, against the browser's
// type, at every call site. `componentDts` shadows owned names to restore the degradation.
test('an imported type colliding with a DOM global degrades to any, not to the DOM type', async () => {
    const files = {
        'src/lib/props.ts': PROPS_SHIM,
        'src/lib/media.ts': 'export interface File { path: string }\n',
        'src/ui/components/Media.abide':
            "<script>import { props } from '../../lib/props.ts'\n" +
            "import type { File } from '../../lib/media.ts'\n" +
            'const { file } = props<{ file: File }>()</script><div>{file.path}</div>\n',
        'src/ui/pages/p/page.abide':
            '<script>\n' +
            "import Media from '../../components/Media.abide'\n" +
            "const picked = { path: 'a.png' }\n" +
            '</script>\n' +
            '<Media file={picked} />\n', // a local File, not a browser File
    }
    const root = await makeProject(files)
    const result = await check(root)
    expect(result.diagnostics).toEqual([])
    expect(result.ok).toBe(true)
})

test('a locally declared type colliding with a DOM global degrades the same way', async () => {
    const files = {
        'src/lib/props.ts': PROPS_SHIM,
        'src/ui/components/Bell.abide':
            "<script>import { props } from '../../lib/props.ts'\n" +
            'type Notification = { text: string }\n' +
            'const { item } = props<{ item: Notification }>()</script><div>{item.text}</div>\n',
        'src/ui/pages/p/page.abide':
            '<script>\n' +
            "import Bell from '../../components/Bell.abide'\n" +
            "const note = { text: 'hi' }\n" +
            '</script>\n' +
            '<Bell item={note} />\n',
    }
    const root = await makeProject(files)
    const result = await check(root)
    expect(result.diagnostics).toEqual([])
    expect(result.ok).toBe(true)
})

// The other half: only OWNED names are shadowed, so a global the script never imports or declares is
// still the global the author meant — and still checked.
test('an un-owned global in a props type stays checked at the call site', async () => {
    const files = {
        'src/lib/props.ts': PROPS_SHIM,
        'src/ui/components/Stamp.abide':
            "<script>import { props } from '../../lib/props.ts'\n" +
            'const { when } = props<{ when: Date }>()</script><div>{when.getTime()}</div>\n',
        'src/ui/pages/p/page.abide':
            '<script>\n' + // 1
            "import Stamp from '../../components/Stamp.abide'\n" + // 2
            '</script>\n' + // 3
            "<Stamp when={'nope'} />\n", // 4: string is not a Date
    }
    const root = await makeProject(files)
    const result = await check(root)
    expect(result.ok).toBe(false)
    expect(
        result.diagnostics.some((d) => d.line === 4 && d.file.endsWith('pages/p/page.abide')),
    ).toBe(true)
})

test('a wrong RPC-style argument in a template call is caught', async () => {
    // A typed function imported into the script, called from the TEMPLATE with a wrong arg type.
    const files = {
        'src/lib/getUser.ts':
            'export function getUser(args: { id: string }): string { return args.id }\n',
        'src/ui/pages/p/page.abide':
            '<script>\n' + // 1
            "import { getUser } from '../../../lib/getUser.ts'\n" + // 2
            '</script>\n' + // 3
            '<p>{getUser({ id: 123 })}</p>\n', // 4  id:number not string → TS2322/2769 on line 4
    }
    const root = await makeProject(files)
    const result = await check(root)
    expect(result.ok).toBe(false)
    expect(result.diagnostics.some((d) => d.line === 4)).toBe(true)
})

test('a bare `{fn()}` interpolation of a promise-returning read is a loud error', async () => {
    const files = {
        'src/lib/getUser.ts': 'export async function getUser(): Promise<string> { return "x" }\n',
        'src/ui/pages/p/page.abide':
            '<script>\n' + // 1
            "import { getUser } from '../../../lib/getUser.ts'\n" + // 2
            '</script>\n' + // 3
            '<p>{getUser()}</p>\n', // 4  bare interpolation of Promise<string> → error on line 4
    }
    const root = await makeProject(files)
    const result = await check(root)
    expect(result.ok).toBe(false)
    const diag = result.diagnostics.find((d) => d.line === 4)
    expect(diag).toBeDefined()
    // The remedy travels with the diagnostic, so the fix is readable without opening the docs.
    expect(diag?.message).toContain('{await expr}')
})

test('`{await fn()}` — the form the diagnostic points at — type-checks clean', async () => {
    const files = {
        'src/lib/getUser.ts': 'export async function getUser(): Promise<string> { return "x" }\n',
        'src/ui/pages/p/page.abide':
            '<script>\n' +
            "import { getUser } from '../../../lib/getUser.ts'\n" +
            '</script>\n' +
            '<p>{await getUser()}</p>\n',
    }
    const root = await makeProject(files)
    const result = await check(root)
    expect(result.diagnostics).toEqual([])
    expect(result.ok).toBe(true)
})

test('a sometimes-thenable value stays legal — the passthrough case the auto-await serves', async () => {
    const files = {
        'src/lib/maybe.ts': 'export function maybe(): string | Promise<string> { return "x" }\n',
        'src/ui/pages/p/page.abide':
            '<script>\n' +
            "import { maybe } from '../../../lib/maybe.ts'\n" +
            '</script>\n' +
            '<p>{maybe()}</p>\n',
    }
    const root = await makeProject(files)
    const result = await check(root)
    expect(result.diagnostics).toEqual([])
    expect(result.ok).toBe(true)
})

// `rpc = memo + transport`, so the promise diagnostic must key on the TYPE, not on which callable it
// is. ADR 0024 classification decides that for a memo: an argless SYNCHRONOUS body returns `T` (and so
// stays legal bare), an async one returns `Promise<T>` (and so reads exactly like a bare RPC read).
//
// The shim must stay STRUCTURALLY faithful to `shared/memo.ts` for the same reason `check.test.ts`'s
// `CELL_MODULE` must: `__abideUnwrap` resolves on the shape, so a simplified stand-in silently takes a
// different overload than the real type does. A flat `{ (): T; peek(); invalidate() }` — which is
// `__AbideMemo` itself — is exactly the shape that cannot reproduce the nullish-unwrap holes below,
// because the real `SyncMemo<T> extends Memo<void, T>` also carries the INHERITED `(args: void):
// Promise<T>` call signature, and that is what the overload is matched against.
const MEMO_SHIM =
    'export interface State<T> { (): T; set(value: T): void; peek(): T }\n' +
    'export interface Memo<Args, T> {\n' +
    '  (args: Args): Promise<T>\n' +
    '  live(args: Args): T | undefined\n' +
    '  invalidate(args?: Args): void\n' +
    '  state(args: Args, initial: T): State<T>\n' +
    '}\n' +
    'export interface SyncMemo<T> extends Memo<void, T> { (): T; state(initial?: T): State<T> }\n' +
    '// The real overload pair, in the real order: a promise-returning body takes the loading overload,\n' +
    '// anything else the synchronous one.\n' +
    'export declare function memo<T>(fn: () => Promise<T>): Memo<void, T>\n' +
    'export declare function memo<T>(fn: () => T): SyncMemo<T>\n'

test('an argless SYNCHRONOUS memo stays legal bare — it returns T, not a promise', async () => {
    const files = {
        'src/lib/memo.ts': MEMO_SHIM,
        'src/ui/pages/p/page.abide':
            '<script>\n' +
            "import { memo } from '../../../lib/memo.ts'\n" +
            'const d = memo(() => 41 + 1)\n' +
            '</script>\n' +
            '<p>{d}</p>\n',
    }
    const result = await check(await makeProject(files))
    expect(result.diagnostics).toEqual([])
    expect(result.ok).toBe(true)
})

// An ASYNC memo is read with an EXPLICIT call, because `memoKind` (analyzeBindings.ts) classifies an
// async body as opaque — the binding is a plain const and the emit never auto-calls it. So the two
// lanes agree that `d` is the memo OBJECT, and the promise the diagnostic is about is `d()`.
test('an ASYNC memo read hits the same diagnostic as a bare RPC read', async () => {
    const files = {
        'src/lib/memo.ts': MEMO_SHIM,
        'src/ui/pages/p/page.abide':
            '<script>\n' + // 1
            "import { memo } from '../../../lib/memo.ts'\n" + // 2
            'const d = memo(async () => "hi")\n' + // 3
            '</script>\n' + // 4
            '<p>{d()}</p>\n', // 5  reads Promise<string> → error
    }
    const result = await check(await makeProject(files))
    expect(result.ok).toBe(false)
    expect(result.diagnostics.find((d) => d.line === 5)?.message).toContain('{await expr}')
})

test('an ASYNC memo read as `{await d()}` type-checks clean', async () => {
    const files = {
        'src/lib/memo.ts': MEMO_SHIM,
        'src/ui/pages/p/page.abide':
            '<script>\n' +
            "import { memo } from '../../../lib/memo.ts'\n" +
            'const d = memo(async () => "hi")\n' +
            '</script>\n' +
            '<p>{await d()}</p>\n',
    }
    const result = await check(await makeProject(files))
    expect(result.diagnostics).toEqual([])
    expect(result.ok).toBe(true)
})

// A NULLISH value type is where the unwrap used to fall off the memo overload and off the widen. Both
// holes were silent — no diagnostic, just a binding typed as something the runtime never produces —
// so each test asserts BOTH halves: the guarded read is clean AND the unguarded one still errors.
// The second half is what tells a real unwrap apart from a collapse to `any`.
test('a memo whose value type includes `undefined` still reads as the VALUE', async () => {
    const files = {
        'src/lib/memo.ts': MEMO_SHIM,
        'src/ui/pages/p/page.abide':
            '<script>\n' +
            "import { memo } from '../../../lib/memo.ts'\n" +
            'const d = memo(() => 1 as number | undefined)\n' +
            '</script>\n' +
            '<p>{d?.toFixed(1)}</p>\n',
    }
    const result = await check(await makeProject(files))
    expect(result.diagnostics).toEqual([])
    expect(result.ok).toBe(true)
})

test('a `T | undefined` memo binding is CHECKED, not widened to any', async () => {
    const files = {
        'src/lib/memo.ts': MEMO_SHIM,
        'src/ui/pages/p/page.abide':
            '<script>\n' + // 1
            "import { memo } from '../../../lib/memo.ts'\n" + // 2
            'const d = memo(() => 1 as number | undefined)\n' + // 3
            '</script>\n' + // 4
            '<p>{d.toFixed(1)}</p>\n', // 5  possibly undefined
    }
    const result = await check(await makeProject(files))
    expect(result.ok).toBe(false)
    expect(result.diagnostics.some((d) => d.code === 18048 && d.line === 5)).toBe(true)
})

test('a memo whose value type includes `null` still reads as the VALUE', async () => {
    const files = {
        'src/lib/memo.ts': MEMO_SHIM,
        'src/ui/pages/p/page.abide':
            '<script>\n' +
            "import { memo } from '../../../lib/memo.ts'\n" +
            'const d = memo(() => 1 as number | null)\n' +
            '</script>\n' +
            '<p>{d?.toFixed(1)}</p>\n',
    }
    const result = await check(await makeProject(files))
    expect(result.diagnostics).toEqual([])
    expect(result.ok).toBe(true)
})

test('a `T | null` memo binding is CHECKED, not widened to any', async () => {
    const files = {
        'src/lib/memo.ts': MEMO_SHIM,
        'src/ui/pages/p/page.abide':
            '<script>\n' + // 1
            "import { memo } from '../../../lib/memo.ts'\n" + // 2
            'const d = memo(() => 1 as number | null)\n' + // 3
            '</script>\n' + // 4
            '<p>{d.toFixed(1)}</p>\n', // 5  possibly null
    }
    const result = await check(await makeProject(files))
    expect(result.ok).toBe(false)
    expect(result.diagnostics.some((d) => d.code === 18047 && d.line === 5)).toBe(true)
})

// QUOTED-ATTRIBUTE INTERPOLATION (`title="Count: {n}"`) is documented public grammar, and the check
// lane used to treat the whole value as opaque text — so an expression inside one was never emitted,
// never type-checked, and invisible to every LSP feature built on the same lowering.
test('an expression inside a quoted attribute value is type-checked and mapped to its line', async () => {
    const page =
        '<script>\n' + // 1
        'const count = 5\n' + // 2  (number)
        '</script>\n' + // 3
        '<p title="Count: {count.toUpperCase()}">x</p>\n' // 4  number has no toUpperCase
    const root = await makeProject({ 'src/ui/pages/p/page.abide': page })
    const result = await check(root)
    expect(result.ok).toBe(false)
    const diag = result.diagnostics.find((d) => d.code === 2339)
    expect(diag).toBeDefined()
    expect(diag?.line).toBe(4)
})

// The LSP half of the same gap. Hover, go-to-definition, rename and find-references all answer from
// the check lowering by mapping a source offset into it, so an expression the lowering never emitted
// was unreachable to every one of them — the identifier was, quite literally, not in the file the
// editor queries. Asserted on the lowering rather than on a diagnostic because a free identifier is
// not itself an error in a template (a text interpolation does not report one either).
test('an expression inside a quoted attribute value is emitted into the check lowering', () => {
    const page =
        "<script>\nconst count = 5\n</script>\n<p title='Count: {count}' id='plain'>x</p>\n"
    const lowered = emitCheck(page, parse(page))
    expect(lowered.code).toContain('__ref(count)')
    // A value with no interpolation stays opaque text — nothing to check, nothing emitted.
    expect(lowered.code).not.toContain('plain')
})

// The other direction, and the more damaging one: an interpolated PROP was typed as the literal
// string `"{n}"`, so a component declaring `count: number` reported an error at every call site of a
// form the build lane compiles to exactly `count={n}`.
test('an interpolated component prop types as its expression, not as a string literal', async () => {
    const root = await makeProject({
        'src/ui/Card.abide':
            "<script>\nimport { props } from 'abide/ui/props'\nconst { count, label } = props<{ count: number; label: string }>()\n</script>\n<b>{label}{count}</b>\n",
        'src/ui/pages/p/page.abide':
            '<script>\n' + // 1
            "import Card from '../../Card.abide'\n" + // 2
            'const n = 5\n' + // 3
            '</script>\n' + // 4
            '<Card count="{n}" label="a {n} b"/>\n', // 5  legal: count is number, label is string
    })
    const result = await check(root)
    expect(result.diagnostics.filter((d) => d.line === 5)).toEqual([])
})
