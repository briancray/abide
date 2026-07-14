import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { checkAbide } from '../src/checkAbide.ts'
import { collectAbideDiagnostics } from '../src/lib/ui/compile/collectAbideDiagnostics.ts'
import {
    createShadowProgram,
    type ShadowProgram,
} from '../src/lib/ui/compile/createShadowProgram.ts'
import { interpolationClassifierForRoot } from '../src/lib/ui/compile/interpolationClassifierForRoot.ts'

/* The real package root, so the throwaway tsconfig resolves `@abide/abide/*` author imports
   (`ui/state`, `ui/effect`, …) to the actual sources — a consuming project resolves them
   through the installed package, so the check must too (else the imported reactive surface
   raises spurious module-resolution noise). */
const PACKAGE_ROOT = resolve(import.meta.dir, '..')

/* A throwaway project with the given `.abide` files (paths may be nested) and a strict
   tsconfig that resolves the `@abide/abide` public surface to the real sources. */
function project(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'abide-check-'))
    writeFileSync(
        join(dir, 'tsconfig.json'),
        JSON.stringify({
            compilerOptions: {
                strict: true,
                module: 'esnext',
                moduleResolution: 'bundler',
                target: 'esnext',
                baseUrl: PACKAGE_ROOT,
                paths: { '@abide/abide/*': ['src/lib/*'] },
            },
        }),
    )
    for (const [name, contents] of Object.entries(files)) {
        const path = join(dir, name)
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, contents)
    }
    return dir
}

/* The two-pass check the `abide` CLI runs (ADR-0032): a verbatim classifier program feeds the
   peek-wrapped diagnostic program, so async interpolations type-check against their RESOLVED value.
   `collectAbideDiagnostics(createShadowProgram(dir))` (no classifier) instead exercises the verbatim
   + suppression fail-open path. */
function wrappedDiagnostics(dir: string): ReturnType<typeof collectAbideDiagnostics> {
    const cache = new Map<string, ShadowProgram | undefined>()
    return collectAbideDiagnostics(
        createShadowProgram(dir, undefined, (abidePath) =>
            interpolationClassifierForRoot(cache, dir, abidePath),
        ),
    )
}

describe('abide check', () => {
    test('a well-typed template produces no diagnostics', () => {
        const dir = project({
            'clean.abide': `<script>\nimport { props } from '@abide/abide/ui/props'\nconst { title } = props<{ title: string }>()\n</script>\n<h1>{title.toUpperCase()}</h1>\n`,
        })
        expect(collectAbideDiagnostics(createShadowProgram(dir))).toHaveLength(0)
    })

    test('an aliased props import (`props as p`) type-checks clean', () => {
        /* Regression: the shadow used to declare the ambient reader under the CANONICAL
           name `props` regardless of the author's local alias, so `p()` read as undefined
           once the real import was stripped. */
        const dir = project({
            'clean.abide': `<script>\nimport { props as p } from '@abide/abide/ui/props'\nconst { title } = p<{ title: string }>()\n</script>\n<h1>{title.toUpperCase()}</h1>\n`,
        })
        expect(collectAbideDiagnostics(createShadowProgram(dir))).toHaveLength(0)
    })

    test('{#if children} is a valid presence test, not an always-true condition', () => {
        /* `children` is optional (undefined when nothing is slotted / no child layer), so
           the fallback form must type-check without a 2774 "always true" false positive. */
        const dir = project({
            'card.abide': `<script>\nimport { props } from '@abide/abide/ui/props'\nimport type { Snippet } from '@abide/abide/shared/snippet'\nconst { children } = props<{ children?: Snippet }>()\n</script>\n<section>{#if children}{children()}{:else}<p>empty</p>{/if}</section>\n`,
        })
        expect(collectAbideDiagnostics(createShadowProgram(dir))).toHaveLength(0)
    })

    test('a wrong member on a typed prop is caught and mapped to the expression', () => {
        const source = `<script>\nimport { props } from '@abide/abide/ui/props'\nconst { count } = props<{ count: number }>()\n</script>\n<h1>{count.toUpperCase()}</h1>\n`
        const dir = project({ 'broken.abide': source })
        const diagnostics = collectAbideDiagnostics(createShadowProgram(dir))
        expect(diagnostics).toHaveLength(1)
        expect(diagnostics[0]!.message).toContain('toUpperCase')
        /* The mapped span lands inside the offending template expression. */
        const span = source.slice(
            diagnostics[0]!.start,
            diagnostics[0]!.start + diagnostics[0]!.length,
        )
        expect('count.toUpperCase()').toContain(span)
    })

    test('a {:catch} error is `unknown`, so an un-narrowed member access is flagged (ADR-0042 fidelity)', () => {
        /* The shadow types a catch binding as `unknown` (not `any`), matching strict TS's real
           `catch (err)` — so `{err.message}` without a narrow is an error inside the template
           exactly as it is outside one. */
        const source = `<script>\nasync function load(): Promise<string> { return 'x' }\n</script>\n{#await load()}<p>loading</p>{:catch err}<p>{err.message}</p>{/await}\n`
        const diagnostics = collectAbideDiagnostics(
            createShadowProgram(project({ 'catch.abide': source })),
        )
        expect(diagnostics).toHaveLength(1)
        expect(diagnostics[0]!.message).toContain("of type 'unknown'")

        /* Narrowing before the access clears it — the faithful pattern TS asks for. */
        const narrowed = `<script>\nasync function load(): Promise<string> { return 'x' }\n</script>\n{#await load()}<p>loading</p>{:catch err}<p>{err instanceof Error ? err.message : String(err)}</p>{/await}\n`
        expect(
            collectAbideDiagnostics(createShadowProgram(project({ 'catch.abide': narrowed }))),
        ).toHaveLength(0)
    })

    test('a wrong prop type on a child component is caught in the parent', () => {
        const dir = project({
            'child.abide': `<script>\nimport { props } from '@abide/abide/ui/props'\nconst { label } = props<{ label: string }>()\n</script>\n<span>{label}</span>\n`,
            'parent.abide': `<script>\nimport Child from './child.abide'\n</script>\n<Child label={42} />\n`,
        })
        const diagnostics = collectAbideDiagnostics(createShadowProgram(dir))
        const parent = diagnostics.filter((diagnostic) => diagnostic.file.endsWith('parent.abide'))
        expect(parent).toHaveLength(1)
        expect(parent[0]!.message).toContain('not assignable')
    })

    test('an IMPORTED props type via the destructure annotation is checked in the parent (ADR-0022 D4)', () => {
        /* `const {…}: MyProps = props()` — the TS-idiomatic annotation form with a type
           imported from a sibling module. Before the `?? declaration.type` fallback the
           annotation was ignored and __Props collapsed to Record<string, any>, so a parent
           could pass anything — a silent false negative. Types now behave like TypeScript. */
        const dir = project({
            'props-types.ts': `export type MyProps = { label: string }\n`,
            'child.abide': `<script>\nimport { props } from '@abide/abide/ui/props'\nimport type { MyProps } from './props-types.ts'\nconst { label }: MyProps = props()\n</script>\n<span>{label}</span>\n`,
            'parent.abide': `<script>\nimport Child from './child.abide'\n</script>\n<Child label={42} />\n`,
        })
        const parent = collectAbideDiagnostics(createShadowProgram(dir)).filter((diagnostic) =>
            diagnostic.file.endsWith('parent.abide'),
        )
        expect(parent).toHaveLength(1)
        expect(parent[0]!.message).toContain('not assignable')
    })

    test('an imported props type via the props<T>() generic is checked in the parent', () => {
        /* The generic-arg form with an imported type already resolves through the shadow's
           real program (ADR-0022 D4 discovery) — a regression lock so it stays that way. */
        const dir = project({
            'props-types.ts': `export type MyProps = { label: string }\n`,
            'child.abide': `<script>\nimport { props } from '@abide/abide/ui/props'\nimport type { MyProps } from './props-types.ts'\nconst { label } = props<MyProps>()\n</script>\n<span>{label}</span>\n`,
            'parent.abide': `<script>\nimport Child from './child.abide'\n</script>\n<Child label={42} />\n`,
        })
        const parent = collectAbideDiagnostics(createShadowProgram(dir)).filter((diagnostic) =>
            diagnostic.file.endsWith('parent.abide'),
        )
        expect(parent).toHaveLength(1)
        expect(parent[0]!.message).toContain('not assignable')
    })

    test('the imported-annotation props form type-checks clean with a valid parent', () => {
        const dir = project({
            'props-types.ts': `export type MyProps = { label: string }\n`,
            'child.abide': `<script>\nimport { props } from '@abide/abide/ui/props'\nimport type { MyProps } from './props-types.ts'\nconst { label }: MyProps = props()\n</script>\n<span>{label.toUpperCase()}</span>\n`,
            'parent.abide': `<script>\nimport Child from './child.abide'\n</script>\n<Child label="hi" />\n`,
        })
        expect(collectAbideDiagnostics(createShadowProgram(dir))).toHaveLength(0)
    })

    test('a call statement with no trailing semicolon does not merge into the next component', () => {
        /* The script's last statement is a call (`effect(...)`) left unterminated, and
           the template starts with a prop-bearing component — whose shadow emission
           begins with `(`. Without a defensive separator the two merge across the
           newline into `effect(...)(...)`, a spurious "not callable" on the author's
           effect. The child prop is well-typed, so the only possible diagnostic is the
           bug; expect none. */
        const dir = project({
            'child.abide': `<script>\nimport { props } from '@abide/abide/ui/props'\nconst { open } = props<{ open: boolean }>()\n</script>\n<span>{open}</span>\n`,
            'host.abide': `<script>\nimport { state } from '@abide/abide/ui/state'\nimport Child from './child.abide'\nlet shown = state(true)\neffect(() => { console.log(shown) })\n</script>\n<Child open={shown} />\n`,
        })
        const diagnostics = collectAbideDiagnostics(createShadowProgram(dir))
        expect(diagnostics.filter((diagnostic) => diagnostic.file.endsWith('host.abide'))).toEqual(
            [],
        )
    })

    test('the child prop is still type-checked after the defensive separator', () => {
        /* The separator must not swallow the prop check: a wrong prop type next to an
           unterminated call still surfaces. */
        const dir = project({
            'child.abide': `<script>\nimport { props } from '@abide/abide/ui/props'\nconst { open } = props<{ open: boolean }>()\n</script>\n<span>{open}</span>\n`,
            'host.abide': `<script>\nimport { state } from '@abide/abide/ui/state'\nimport Child from './child.abide'\nlet shown = state(0)\neffect(() => { console.log(shown) })\n</script>\n<Child open={shown} />\n`,
        })
        const diagnostics = collectAbideDiagnostics(createShadowProgram(dir)).filter((diagnostic) =>
            diagnostic.file.endsWith('host.abide'),
        )
        expect(diagnostics).toHaveLength(1)
        expect(diagnostics[0]!.message).toContain('not assignable')
    })

    test('html() without an import is an unresolved-name diagnostic', () => {
        /* `html` is no longer auto-injected into the shadow preamble — it is author-imported
           from `abide/ui/html`. A template that calls it without the import must fail to
           type-check rather than silently resolve. */
        const source = `<div>{html('<b>x</b>')}</div>\n`
        const dir = project({ 'raw.abide': source })
        const diagnostics = collectAbideDiagnostics(createShadowProgram(dir))
        expect(
            diagnostics.some((diagnostic) =>
                diagnostic.message.includes("Cannot find name 'html'"),
            ),
        ).toBe(true)
    })

    test('html() with the ui/html import resolves the name', () => {
        /* The import satisfies `html` — no unresolved-name diagnostic. (The tmp project has
           no installed `@abide/abide`, so the import line itself raises a module-resolution
           error that a real consuming project would not; that is orthogonal to name binding,
           so assert specifically that the name resolves.) */
        const dir = project({
            'raw.abide': `<script>\nimport { html } from '@abide/abide/ui/html'\n</script>\n<div>{html('<b>x</b>')}</div>\n`,
        })
        const diagnostics = collectAbideDiagnostics(createShadowProgram(dir))
        expect(
            diagnostics.some((diagnostic) =>
                diagnostic.message.includes("Cannot find name 'html'"),
            ),
        ).toBe(false)
    })

    test('an author binding using the reserved $$ prefix is a diagnostic', () => {
        const dir = project({
            'reserved.abide': `<script>const $$each = 1</script>\n<p>{$$each}</p>\n`,
        })
        const diagnostics = collectAbideDiagnostics(createShadowProgram(dir))
        expect(diagnostics.some((diagnostic) => diagnostic.message.includes('reserved'))).toBe(true)
    })

    test('a normal binding named after a helper (no $$) is allowed', () => {
        /* The whole point of the reserved namespace: `each`/`on`/`model` are free for users. */
        const dir = project({
            'ok.abide': `<script>const each = [1]\nconst model = 2\nconst on = 3</script>\n<p>{each.length}-{model}-{on}</p>\n`,
        })
        const diagnostics = collectAbideDiagnostics(createShadowProgram(dir))
        expect(diagnostics.some((diagnostic) => diagnostic.message.includes('reserved'))).toBe(
            false,
        )
    })

    /* The `<template else>` is a CHILD of the `<template if>` (the canonical syntax the
       runtime pairs — see `generateIf`), emitted as a real `if (…) {…} else {…}`, so its
       body carries the condition's NEGATIVE narrowing — here `v` is `number` in the else,
       not the union. Regression: the else child was emitted inside the `if` block and got
       the positive narrowing, so `toFixed` errored on the narrowed `string`. */
    test('a nested else child carries the condition negative narrowing', () => {
        const dir = project({
            'elseok.abide': `<script>\nimport { props } from '@abide/abide/ui/props'\nconst { v } = props<{ v: string | number }>()\n</script>\n{#if typeof v === 'string'}{v.toUpperCase()}{:else}{v.toFixed(2)}{/if}\n`,
        })
        expect(collectAbideDiagnostics(createShadowProgram(dir))).toHaveLength(0)
    })

    /* An `<template elseif>` compiles to a real `else if`, so its body inherits the prior
       conditions' negative narrowing plus its own positive — here the discriminant lands
       each branch on the right union member, so every member access is well-typed. */
    test('an elseif branch carries the correct discriminated narrowing', () => {
        const dir = project({
            'shape.abide': `<script>\nimport { props } from '@abide/abide/ui/props'\nconst { s } = props<{ s: { k: 'circle'; r: number } | { k: 'square'; side: number } | { k: 'none' } }>()\n</script>\n{#if s.k === 'circle'}{s.r}{:else if s.k === 'square'}{s.side}{:else}none{/if}\n`,
        })
        expect(collectAbideDiagnostics(createShadowProgram(dir))).toHaveLength(0)
    })

    /* The same chain, but the elseif body reads a member that only exists on a DIFFERENT
       member — proof the branch is narrowed to `square`, not the widened union. */
    test('a wrong member inside an elseif branch is caught', () => {
        const dir = project({
            'shapebad.abide': `<script>\nimport { props } from '@abide/abide/ui/props'\nconst { s } = props<{ s: { k: 'circle'; r: number } | { k: 'square'; side: number } }>()\n</script>\n{#if s.k === 'circle'}{s.r}{:else if s.k === 'square'}{s.r}{/if}\n`,
        })
        const diagnostics = collectAbideDiagnostics(createShadowProgram(dir))
        expect(diagnostics).toHaveLength(1)
        expect(diagnostics[0]!.message).toContain('r')
    })

    /* A template-literal-union subject narrows across an if/else and a switch the same as
       a plain literal union. Regression: inside the else child the subject kept the if's
       positive narrowing, so a compare against another member read as "no overlap" — the
       error a downstream app worked around with hand-rolled string-cast deriveds. */
    test('a template-literal union narrows across a nested if/else and a switch', () => {
        const head = `<script>\nimport { props } from '@abide/abide/ui/props'\ntype LayoutKey = \`layout-\${'home' | 'about'}\`\nconst { layoutKey } = props<{ layoutKey: LayoutKey }>()\n</script>\n`
        const ifElse = project({
            'a.abide': `${head}{#if layoutKey === 'layout-home'}home{:else}{layoutKey === 'layout-about' ? 'a' : 'x'}{/if}\n`,
        })
        expect(collectAbideDiagnostics(createShadowProgram(ifElse))).toHaveLength(0)
        const switched = project({
            'b.abide': `${head}{#switch layoutKey}\n{:case 'layout-home'}home\n{:default}{layoutKey}\n{/switch}\n`,
        })
        expect(collectAbideDiagnostics(createShadowProgram(switched))).toHaveLength(0)
    })

    /* A real `switch` narrows the discriminant subject into each case body. */
    test('a switch case narrows a discriminated union subject', () => {
        const dir = project({
            'shape.abide': `<script>\nimport { props } from '@abide/abide/ui/props'\ntype Shape = { kind: 'circle'; r: number } | { kind: 'square'; side: number }\nconst { shape } = props<{ shape: Shape }>()\n</script>\n{#switch shape.kind}\n  {:case 'circle'}{shape.r}\n  {:case 'square'}{shape.side}\n{/switch}\n`,
        })
        expect(collectAbideDiagnostics(createShadowProgram(dir))).toHaveLength(0)
    })

    /* An async each iterates with `for await`, so the item binds to the AsyncIterable's
       element type instead of erroring on the missing sync iterator. */
    test('an async each binds the AsyncIterable element type', () => {
        const dir = project({
            'stream.abide': `<script>\nimport { props } from '@abide/abide/ui/props'\nconst { stream } = props<{ stream: AsyncIterable<number> }>()\n</script>\n{#for await n of stream}{n.toFixed(2)}{/for}\n`,
        })
        expect(collectAbideDiagnostics(createShadowProgram(dir))).toHaveLength(0)
    })

    /* ADR-0032: a promise in an attribute value now LIFTS to a peek-cell — it is no longer a
       value-position error, so `abide check` raises no diagnostic for it. */
    test('a promise in an attribute value is no longer flagged (it lifts to a peek-cell)', () => {
        const source = `<script>\nimport { props } from '@abide/abide/ui/props'\nconst { title } = props<{ title: Promise<string> }>()\n</script>\n<div class={title}></div>\n`
        const dir = project({ 'attr.abide': source })
        const diagnostics = collectAbideDiagnostics(createShadowProgram(dir))
        expect(diagnostics).toHaveLength(0)
    })

    /* ADR-0032 D4a: the ONE remaining value-position error — a raw `AsyncIterable` driving a
       PLAIN `{#for}` (a frame is not a collection; iterate with `{#for await}`). Flagged and
       mapped to the items expression. */
    test('a raw AsyncIterable in a plain {#for} is flagged and mapped to the items expression', () => {
        const source = `<script>\nimport { props } from '@abide/abide/ui/props'\nconst { stream } = props<{ stream: AsyncIterable<number> }>()\n</script>\n{#for n of stream}<p>{n}</p>{/for}\n`
        const dir = project({ 'each.abide': source })
        const diagnostics = collectAbideDiagnostics(createShadowProgram(dir))
        const flagged = diagnostics.filter((diagnostic) =>
            diagnostic.message.includes('{#for await}'),
        )
        expect(flagged).toHaveLength(1)
        /* The span lands on the offending items expression. */
        const span = source.slice(flagged[0]!.start, flagged[0]!.start + flagged[0]!.length)
        expect(span).toBe('stream')
    })

    /* The sanctioned `{#for await}` iterable is exempt — an AsyncIterable there is valid. */
    test('an AsyncIterable in {#for await} raises no value-position diagnostic', () => {
        const source = `<script>\nimport { props } from '@abide/abide/ui/props'\nconst { stream } = props<{ stream: AsyncIterable<number> }>()\n</script>\n{#for await n of stream}{n.toFixed(2)}{/for}\n`
        const dir = project({ 'ok.abide': source })
        expect(collectAbideDiagnostics(createShadowProgram(dir))).toHaveLength(0)
    })

    /* ADR-0032: a bare async read is a peek at the RESOLVED value (`undefined` while pending), so
       an optional read of a real member composes with `?.`/`??` and type-checks clean — the raw
       `Promise` shadow's "property missing" / "always defined" diagnostics are suppressed. */
    test('a bare async optional read and {#if} subject type-check clean', () => {
        const head = `<script>\nimport { props } from '@abide/abide/ui/props'\nconst { load } = props<{ load: Promise<{ name: string }> }>()\n</script>\n`
        const read = project({ 'read.abide': `${head}<p>{load?.name ?? 'loading'}</p>\n` })
        expect(collectAbideDiagnostics(createShadowProgram(read))).toHaveLength(0)
        const branch = project({ 'if.abide': `${head}{#if load}yes{:else}no{/if}\n` })
        expect(collectAbideDiagnostics(createShadowProgram(branch))).toHaveLength(0)
    })

    /* The suppression is a peek at the RESOLVED type, not a blanket mute: a member that doesn't
       exist on the awaited value is still a real error (a typo isn't hidden). */
    test('a wrong member on a bare async read is still caught against the resolved type', () => {
        const dir = project({
            'typo.abide': `<script>\nimport { props } from '@abide/abide/ui/props'\nconst { load } = props<{ load: Promise<{ name: string }> }>()\n</script>\n<p>{load?.bogus}</p>\n`,
        })
        const diagnostics = collectAbideDiagnostics(createShadowProgram(dir))
        expect(diagnostics).toHaveLength(1)
        expect(diagnostics[0]!.message).toContain('bogus')
    })

    /* Only OPTIONAL (`?.`) access is the peek — a bare `.name` on a promise is the ADR-0032 footgun
       (`__v.name` throws on `undefined` while pending), so it stays an error nudging toward `?.`. */
    test('a non-optional member on a bare async read stays an error', () => {
        const dir = project({
            'bare.abide': `<script>\nimport { props } from '@abide/abide/ui/props'\nconst { load } = props<{ load: Promise<{ name: string }> }>()\n</script>\n<p>{load.name}</p>\n`,
        })
        const diagnostics = collectAbideDiagnostics(createShadowProgram(dir))
        expect(diagnostics).toHaveLength(1)
        expect(diagnostics[0]!.message).toContain('name')
    })

    /* The suppression is gated to the template region — a promise member access in the `<script>`
       (a forgotten `await`) must still surface, so the peek relaxation never leaks into script code. */
    test('a promise member access in the leading <script> is still an error', () => {
        const dir = project({
            'script.abide': `<script>\nimport { props } from '@abide/abide/ui/props'\nconst { load } = props<{ load: Promise<{ name: string }> }>()\nconst leaked = load.name\n</script>\n<p>{leaked}</p>\n`,
        })
        const diagnostics = collectAbideDiagnostics(createShadowProgram(dir))
        expect(diagnostics.some((diagnostic) => diagnostic.message.includes('name'))).toBe(true)
    })

    /* A bare `AsyncIterable` read peeks its latest FRAME, so an optional read of a frame member
       type-checks the same way (the frame type, not the un-awaited iterable). */
    test('a bare async-iterable optional read type-checks against the frame type', () => {
        const dir = project({
            'frame.abide': `<script>\nimport { props } from '@abide/abide/ui/props'\nconst { stream } = props<{ stream: AsyncIterable<{ label: string }> }>()\n</script>\n<p>{stream?.label ?? '—'}</p>\n`,
        })
        expect(collectAbideDiagnostics(createShadowProgram(dir))).toHaveLength(0)
    })

    /* Under the CLI's two-pass wrap, an async interpolation type-checks against its RESOLVED value
       (`$$peek(load)?.name`), so hover/completions see `{ name: string }`, not `Promise<…>`, and a
       clean read plus an `{#if}` subject raise no diagnostic. */
    test('the peek-wrap resolves a bare async read — clean read and {#if} type-check', () => {
        const head = `<script>\nimport { props } from '@abide/abide/ui/props'\nconst { load } = props<{ load: Promise<{ name: string }> }>()\n</script>\n`
        const read = project({ 'read.abide': `${head}<p>{load?.name ?? 'loading'}</p>\n` })
        expect(wrappedDiagnostics(read)).toHaveLength(0)
        const branch = project({ 'if.abide': `${head}{#if load}yes{:else}no{/if}\n` })
        expect(wrappedDiagnostics(branch)).toHaveLength(0)
    })

    /* The wrap checks a typo against the AWAITED shape, so the error names the resolved type
       (`{ name: string }`) rather than the raw `Promise` — the resolved-type feedback the peek gives. */
    test('the peek-wrap reports a typo against the awaited type, not the promise', () => {
        const dir = project({
            'typo.abide': `<script>\nimport { props } from '@abide/abide/ui/props'\nconst { load } = props<{ load: Promise<{ name: string }> }>()\n</script>\n<p>{load?.bogus}</p>\n`,
        })
        const diagnostics = wrappedDiagnostics(dir)
        expect(diagnostics).toHaveLength(1)
        expect(diagnostics[0]!.message).toContain('bogus')
        expect(diagnostics[0]!.message).toContain('{ name: string; }')
        expect(diagnostics[0]!.message).not.toContain('Promise')
    })

    /* The streaming `then` branch binds the awaited value, so a wrong member on the
       resolved data is caught (previously bound as `any`, silently unchecked). */
    test('a streaming then branch type-checks the resolved value', () => {
        const dir = project({
            'await.abide': `<script>\nimport { props } from '@abide/abide/ui/props'\nconst { load } = props<{ load: Promise<{ title: string }> }>()\n</script>\n{#await load}loading{:then data}{data.bogus}{/await}\n`,
        })
        const diagnostics = collectAbideDiagnostics(createShadowProgram(dir))
        expect(diagnostics).toHaveLength(1)
        expect(diagnostics[0]!.message).toContain('bogus')
    })

    /* `state<T>()` (no initial) is `T | undefined`: a guard narrows cleanly (no
       "never"), an unguarded access is flagged possibly-undefined, and the bare
       declaration is not a use-before-assign false-positive. */
    test('a no-arg state is a defined T | undefined that narrows', () => {
        const guarded = project({
            'g.abide': `<script>\nimport { state } from '@abide/abide/ui/state'\nlet x = state<string>()\n</script>\n{#if x !== undefined}<span>{x.toUpperCase()}</span>{/if}\n`,
        })
        expect(collectAbideDiagnostics(createShadowProgram(guarded))).toHaveLength(0)

        const unguarded = project({
            'u.abide': `<script>\nimport { state } from '@abide/abide/ui/state'\nlet x = state<string>()\n</script>\n<span>{x.toUpperCase()}</span>\n`,
        })
        const diagnostics = collectAbideDiagnostics(createShadowProgram(unguarded))
        expect(diagnostics).toHaveLength(1)
        expect(diagnostics[0]!.message).toContain('possibly')
    })

    /* `state<T>(undefined)` is the no-arg form spelled out — an explicit `undefined`
       initial with a declared type, so it is `T | undefined` (never `= (undefined)`
       checked against a non-optional `T`, which spuriously flagged "not assignable"). */
    test('state<T>(undefined) is T | undefined, not an "undefined not assignable" error', () => {
        const guarded = project({
            'g.abide': `<script>\nimport { state } from '@abide/abide/ui/state'\nlet x = state<string>(undefined)\n</script>\n{#if x !== undefined}<span>{x.toUpperCase()}</span>{/if}\n`,
        })
        expect(collectAbideDiagnostics(createShadowProgram(guarded))).toHaveLength(0)
    })

    /* A binding annotation pins the cell type just like the generic does: `let x: T =
       state(v)` must carry `: T` into the shadow, so a narrow/`any` inference of the
       initial (`state([])` → `any[]`) can't leak and produce unrelated errors downstream. */
    test('let x: T = state(v) honors the binding annotation (not the initial inference)', () => {
        const dir = project({
            'b.abide': `<script>\nimport { state } from '@abide/abide/ui/state'\ntype Item = { id: number }\nlet items: Item[] = state([])\n</script>\n<button onclick={() => { items = [...items, { id: 1 }] }}>{items.length}</button>\n`,
        })
        expect(collectAbideDiagnostics(createShadowProgram(dir))).toHaveLength(0)
    })

    /* A binding annotation is also honored with no initial (`let x: T = state()`): the
       value is `T | undefined`, narrowing cleanly under a guard. */
    test('let x: T = state() with a binding annotation is T | undefined', () => {
        const dir = project({
            'n.abide': `<script>\nimport { state } from '@abide/abide/ui/state'\nlet x: string = state()\n</script>\n{#if x !== undefined}<span>{x.toUpperCase()}</span>{/if}\n`,
        })
        expect(collectAbideDiagnostics(createShadowProgram(dir))).toHaveLength(0)
    })

    /* The full range model accepts any branch content, including a component plus
       static text directly in a branch — type-checks clean. */
    test('check accepts a component and text directly in a control-flow branch', () => {
        const dir = project({
            'child.abide': `<script>\nimport { props } from '@abide/abide/ui/props'\nconst { label } = props<{ label: string }>()\n</script>\n<span>{label}</span>\n`,
            'ok.abide': `<script>\nimport { state } from '@abide/abide/ui/state'\nimport Child from './child.abide'\nlet on = state(true)\n</script>\n{#if on}<Child label="x"/>plain{/if}\n`,
        })
        expect(
            collectAbideDiagnostics(createShadowProgram(dir)).filter((diagnostic) =>
                diagnostic.file.endsWith('ok.abide'),
            ),
        ).toEqual([])
    })

    /* A static `import` in a nested `<template>` script is rejected with a clear
       diagnostic pointing at the leading `<script>` — it can't compile (an import is
       illegal inside the branch's render body) and would falsely imply lazy loading. */
    test('a static import in a nested script is rejected with a clear diagnostic', () => {
        const dir = project({
            'badimport.abide': `<script>\nimport { state } from '@abide/abide/ui/state'\nlet on = state(true)\n</script>\n{#if on}\n<script>import Heavy from './child.abide'</script>\n{/if}\n`,
            'child.abide': `<script>\nimport { props } from '@abide/abide/ui/props'\nconst { label } = props<{ label: string }>()\n</script>\n<span>{label}</span>\n`,
        })
        const diagnostics = collectAbideDiagnostics(createShadowProgram(dir)).filter((diagnostic) =>
            diagnostic.file.endsWith('badimport.abide'),
        )
        expect(diagnostics).toHaveLength(1)
        expect(diagnostics[0]!.message).toContain('leading <script>')
    })

    /* Top-level `await` in the leading `<script>` runs in the synchronous `build()`, so it
       breaks the bundle. Check must catch it (the shadow's render fn is async, so `tsc` alone
       lets it pass) and point at the `{#await}` markup alternative. */
    test('top-level await in the leading <script> is rejected with a clear diagnostic', () => {
        const source = `<script>\nconst session = await fetch('/api/session')\n</script>\n<p>{session.url}</p>\n`
        const dir = project({ 'topawait.abide': source })
        const diagnostics = collectAbideDiagnostics(createShadowProgram(dir)).filter((diagnostic) =>
            diagnostic.file.endsWith('topawait.abide'),
        )
        expect(diagnostics.some((diagnostic) => diagnostic.message.includes('{#await'))).toBe(true)
        /* The flagged span lands on the offending `await` keyword. */
        const awaitDiagnostic = diagnostics.find((diagnostic) =>
            diagnostic.message.includes('{#await'),
        )!
        const span = source.slice(
            awaitDiagnostic.start,
            awaitDiagnostic.start + awaitDiagnostic.length,
        )
        expect(span).toBe('await')
    })

    /* `for await` over an async iterable at the top level is the same trap. */
    test('top-level for-await in the leading <script> is rejected', () => {
        const source = `<script>\nimport { state } from '@abide/abide/ui/state'\nlet last = state(0)\nfor await (const n of stream()) { last = n }\ndeclare function stream(): AsyncIterable<number>\n</script>\n<p>{last}</p>\n`
        const dir = project({ 'forawait.abide': source })
        const diagnostics = collectAbideDiagnostics(createShadowProgram(dir)).filter((diagnostic) =>
            diagnostic.file.endsWith('forawait.abide'),
        )
        expect(diagnostics.some((diagnostic) => diagnostic.message.includes('{#await'))).toBe(true)
    })

    /* A nested `<script>` (scoped reactive block) inlines into `build()` too, so a top-level
       await in one is the same trap — flagged and mapped through the nested body's offset. */
    test('top-level await in a nested <script> is rejected with a clear diagnostic', () => {
        const source = `<script>\nimport { state } from '@abide/abide/ui/state'\nlet on = state(true)\n</script>\n{#if on}\n<script>const data = await fetch('/y')</script>\n<p>{data.url}</p>\n{/if}\n`
        const dir = project({ 'nestedawait.abide': source })
        const diagnostics = collectAbideDiagnostics(createShadowProgram(dir)).filter((diagnostic) =>
            diagnostic.file.endsWith('nestedawait.abide'),
        )
        const awaitDiagnostic = diagnostics.find((diagnostic) =>
            diagnostic.message.includes('{#await'),
        )
        expect(awaitDiagnostic).toBeDefined()
        /* The flagged span maps through the nested body's offset onto the `await` keyword. */
        const span = source.slice(
            awaitDiagnostic!.start,
            awaitDiagnostic!.start + awaitDiagnostic!.length,
        )
        expect(span).toBe('await')
    })

    /* `await` inside an async function (e.g. an event handler) is legitimate — the function
       carries its own async scope and is never inlined into `build()`. Not flagged. */
    test('await inside an async function in the leading <script> is allowed', () => {
        const source = `<script>\nasync function load() { return await fetch('/x') }\n</script>\n<button on:click={() => load()}>go</button>\n`
        const dir = project({ 'okawait.abide': source })
        const diagnostics = collectAbideDiagnostics(createShadowProgram(dir)).filter((diagnostic) =>
            diagnostic.file.endsWith('okawait.abide'),
        )
        expect(diagnostics).toEqual([])
    })

    /* A dynamic `import()` in a nested script is the legitimate lazy path — not flagged. */
    test('a dynamic import in a nested script is allowed', () => {
        const dir = project({
            'lazy.abide': `<script>\nimport { state } from '@abide/abide/ui/state'\nlet p = state(Promise.resolve(1))\n</script>\n{#await p then v}\n<script>effect(() => { void import('./child.abide') })</script>\n<span>{v}</span>\n{/await}\n`,
            'child.abide': `<script>\nimport { props } from '@abide/abide/ui/props'\nconst { label } = props<{ label: string }>()\n</script>\n<span>{label}</span>\n`,
        })
        expect(
            collectAbideDiagnostics(createShadowProgram(dir)).filter((diagnostic) =>
                diagnostic.file.endsWith('lazy.abide'),
            ),
        ).toEqual([])
    })

    /* `scope()` is the internal lowering host — no longer an author reactive entry, but a
       captured handle (`const s = scope()`) and its method calls (`s.share(...)`) are
       emitted verbatim and must still resolve in the shadow. The imported reactive surface
       (`state`/`state.computed`) is projected to its value type. Regression for the shadow
       preamble missing the `scope` import after the doc→scope migration. */
    test('scope() handle + method calls and the imported reactive surface type-check', () => {
        const dir = project({
            'scoped.abide': `<script>\nimport { state } from '@abide/abide/ui/state'\nconst s = scope()\nconst count = state(0)\nconst doubled = state.computed(() => count * 2)\nfunction tag() { s.share('count', count) }\n</script>\n<button onclick={tag}>{count} {doubled}</button>\n`,
        })
        expect(collectAbideDiagnostics(createShadowProgram(dir))).toHaveLength(0)
    })

    /* `const {…} = props<Shape>()` types each binding from `Shape`: a clean read
       type-checks, a `= default` narrows, and the shape is the parent-facing prop type
       so a wrong-typed prop on a child is still caught in the parent. */
    test('a typed props() destructure checks its bindings and the parent prop', () => {
        const clean = project({
            'card.abide': `<script>\nimport { props } from '@abide/abide/ui/props'\nconst { lang = 'ts', code } = props<{ lang?: string; code: string }>()\n</script>\n<pre data-lang={lang.toUpperCase()}>{code}</pre>\n`,
        })
        expect(collectAbideDiagnostics(createShadowProgram(clean))).toHaveLength(0)

        const badMember = project({
            'card.abide': `<script>\nimport { props } from '@abide/abide/ui/props'\nconst { lang = 'ts' } = props<{ lang?: string }>()\n</script>\n<pre>{lang.toFixed(2)}</pre>\n`,
        })
        const memberDiagnostics = collectAbideDiagnostics(createShadowProgram(badMember))
        expect(memberDiagnostics).toHaveLength(1)
        expect(memberDiagnostics[0]!.message).toContain('toFixed')

        const badParent = project({
            'card.abide': `<script>\nimport { props } from '@abide/abide/ui/props'\nconst { code } = props<{ code: string }>()\n</script>\n<pre>{code}</pre>\n`,
            'page.abide': `<script>\nimport Card from './card.abide'\n</script>\n<Card code={42} />\n`,
        })
        const parent = collectAbideDiagnostics(createShadowProgram(badParent)).filter(
            (diagnostic) => diagnostic.file.endsWith('page.abide'),
        )
        expect(parent).toHaveLength(1)
        expect(parent[0]!.message).toContain('not assignable')
    })

    /* A nested scoped `<script>`'s bindings reach the branch's later siblings,
       including a nested if/each within the same branch (emitted inline, not in a
       trapping block that left them "Cannot find name"). */
    test('a nested-script binding reaches a deeply nested block in the branch', () => {
        const dir = project({
            'nested.abide': `<script>\nimport { state } from '@abide/abide/ui/state'\nlet p = state(Promise.resolve(1))\n</script>\n{#await p then v}\n<script>const label = String(v)</script>\n<div>{#if v > 0}<span>{label}</span>{/if}</div>\n{/await}\n`,
        })
        expect(collectAbideDiagnostics(createShadowProgram(dir))).toHaveLength(0)
    })

    /* A missing REQUIRED child prop is caught in the parent — the mount must demand the
       component's full prop shape, not just check the props that were supplied. */
    test('a missing required child prop is caught in the parent', () => {
        const dir = project({
            'child.abide': `<script>\nimport { props } from '@abide/abide/ui/props'\nconst { label } = props<{ label: string }>()\n</script>\n<span>{label}</span>\n`,
            'parent.abide': `<script>\nimport Child from './child.abide'\n</script>\n<Child />\n`,
        })
        const parent = collectAbideDiagnostics(createShadowProgram(dir)).filter((diagnostic) =>
            diagnostic.file.endsWith('parent.abide'),
        )
        expect(parent).toHaveLength(1)
        expect(parent[0]!.message).toContain('label')
    })

    /* Slotted content (`<Card>…</Card>`) supplies the child's `children` prop at runtime,
       so a REQUIRED `children: Snippet` must NOT read as missing when content is slotted —
       the shadow's completeness check drops `children`'s required-ness whenever the mount
       carries renderable slot content. (The checker doesn't otherwise see the slot as
       satisfying the prop, which forced `children` optional as a workaround.) */
    test('slotted content satisfies a required children prop', () => {
        const dir = project({
            'card.abide': `<script>\nimport { props } from '@abide/abide/ui/props'\nimport type { Snippet } from '@abide/abide/shared/snippet'\nconst { children } = props<{ children: Snippet }>()\n</script>\n<section>{children()}</section>\n`,
            'parent.abide': `<script>\nimport Card from './card.abide'\n</script>\n<Card>hello</Card>\n`,
        })
        const parent = collectAbideDiagnostics(createShadowProgram(dir)).filter((diagnostic) =>
            diagnostic.file.endsWith('parent.abide'),
        )
        expect(parent).toHaveLength(0)
    })

    /* Only renderable slot content counts: a childless mount (`<Card />`) of a required-
       `children` component is still flagged, and whitespace-only content doesn't satisfy it
       either — matching the runtime, where an empty slot sets no `children` layer. */
    test('a childless mount of a required-children component is still flagged', () => {
        const dir = project({
            'card.abide': `<script>\nimport { props } from '@abide/abide/ui/props'\nimport type { Snippet } from '@abide/abide/shared/snippet'\nconst { children } = props<{ children: Snippet }>()\n</script>\n<section>{children()}</section>\n`,
            'childless.abide': `<script>\nimport Card from './card.abide'\n</script>\n<Card />\n`,
            'blank.abide': `<script>\nimport Card from './card.abide'\n</script>\n<Card>\n  \n</Card>\n`,
        })
        const diagnostics = collectAbideDiagnostics(createShadowProgram(dir))
        expect(
            diagnostics.filter((diagnostic) => diagnostic.file.endsWith('childless.abide')),
        ).toHaveLength(1)
        expect(
            diagnostics.filter((diagnostic) => diagnostic.file.endsWith('blank.abide')),
        ).toHaveLength(1)
    })

    /* Slot content relaxes ONLY `children` — every other required prop is still demanded,
       and an excess prop is still caught even when `children` is the child's sole declared
       prop (the completeness type keeps `children` a known-optional key rather than
       collapsing to a props-permissive `{}`). */
    test('slot content relaxes only children — other completeness checks hold', () => {
        const dir = project({
            'card.abide': `<script>\nimport { props } from '@abide/abide/ui/props'\nimport type { Snippet } from '@abide/abide/shared/snippet'\nconst { title, children } = props<{ title: string; children: Snippet }>()\n</script>\n<section>{title}{children()}</section>\n`,
            'onlyChildren.abide': `<script>\nimport { props } from '@abide/abide/ui/props'\nimport type { Snippet } from '@abide/abide/shared/snippet'\nconst { children } = props<{ children: Snippet }>()\n</script>\n<section>{children()}</section>\n`,
            'missing.abide': `<script>\nimport Card from './card.abide'\n</script>\n<Card>hi</Card>\n`,
            'excess.abide': `<script>\nimport Card from './onlyChildren.abide'\n</script>\n<Card bogus={1}>hi</Card>\n`,
        })
        const diagnostics = collectAbideDiagnostics(createShadowProgram(dir))
        const missing = diagnostics.filter((diagnostic) =>
            diagnostic.file.endsWith('missing.abide'),
        )
        expect(missing).toHaveLength(1)
        expect(missing[0]!.message).toContain('title')
        const excess = diagnostics.filter((diagnostic) => diagnostic.file.endsWith('excess.abide'))
        expect(excess).toHaveLength(1)
        expect(excess[0]!.message).toContain('bogus')
    })

    /* A component that declares NO `children` still accepts slotted content leniently — the
       relaxation is a no-op on its shape (the slot's `children` layer is simply unread), so
       the mount doesn't spuriously error on an undeclared `children`. */
    test('a component declaring no children accepts slot content leniently', () => {
        const dir = project({
            'card.abide': `<script>\nimport { props } from '@abide/abide/ui/props'\nconst { title } = props<{ title: string }>()\n</script>\n<h2>{title}</h2>\n`,
            'parent.abide': `<script>\nimport Card from './card.abide'\n</script>\n<Card title="x">ignored</Card>\n`,
        })
        const parent = collectAbideDiagnostics(createShadowProgram(dir)).filter((diagnostic) =>
            diagnostic.file.endsWith('parent.abide'),
        )
        expect(parent).toHaveLength(0)
    })

    /* An unknown/excess child prop is caught in the parent — a typo'd prop name should
       not pass silently. */
    test('an excess unknown child prop is caught in the parent', () => {
        const dir = project({
            'child.abide': `<script>\nimport { props } from '@abide/abide/ui/props'\nconst { label } = props<{ label: string }>()\n</script>\n<span>{label}</span>\n`,
            'parent.abide': `<script>\nimport Child from './child.abide'\n</script>\n<Child label="x" bogusProp={1} />\n`,
        })
        const parent = collectAbideDiagnostics(createShadowProgram(dir)).filter((diagnostic) =>
            diagnostic.file.endsWith('parent.abide'),
        )
        expect(parent).toHaveLength(1)
        expect(parent[0]!.message).toContain('bogusProp')
    })

    /* A hyphenated prop name (`aria-label`, `data-*`) isn't a valid identifier, so its key
       must be quoted in the emitted props literal — otherwise the parser reads `aria-label`
       as `aria - label` and floods the file with spurious errors. A declared hyphenated prop
       passed correctly produces no diagnostics. */
    test('a declared hyphenated child prop type-checks cleanly', () => {
        const dir = project({
            'child.abide': `<script>\nimport { props } from '@abide/abide/ui/props'\nconst { 'aria-label': ariaLabel } = props<{ 'aria-label': string }>()\n</script>\n<span aria-label={ariaLabel} />\n`,
            'parent.abide': `<script>\nimport Child from './child.abide'\n</script>\n<Child aria-label="open" />\n`,
        })
        const parent = collectAbideDiagnostics(createShadowProgram(dir)).filter((diagnostic) =>
            diagnostic.file.endsWith('parent.abide'),
        )
        expect(parent).toHaveLength(0)
    })

    /* The quoted key still anchors an excess-prop error onto the source name: an undeclared
       hyphenated prop is caught and maps back to its `data-bogus` location. */
    test('an excess hyphenated child prop is caught and mapped to its name', () => {
        const source = `<script>\nimport Child from './child.abide'\n</script>\n<Child label="x" data-bogus="y" />\n`
        const dir = project({
            'child.abide': `<script>\nimport { props } from '@abide/abide/ui/props'\nconst { label } = props<{ label: string }>()\n</script>\n<span>{label}</span>\n`,
            'parent.abide': source,
        })
        const parent = collectAbideDiagnostics(createShadowProgram(dir)).filter((diagnostic) =>
            diagnostic.file.endsWith('parent.abide'),
        )
        expect(parent).toHaveLength(1)
        expect(parent[0]!.message).toContain('data-bogus')
        const span = source.slice(parent[0]!.start, parent[0]!.start + parent[0]!.length)
        expect('data-bogus').toContain(span)
    })

    /* A required `on*` callback prop is satisfied when passed — `on*` props on a component
       are ordinary declared props, not DOM passthrough, so a passed `onsave` must not read
       as a missing required prop. */
    test('a passed required on* callback prop satisfies the child shape', () => {
        const dir = project({
            'child.abide': `<script>\nimport { props } from '@abide/abide/ui/props'\nconst { label, onsave } = props<{ label: string; onsave: () => void }>()\n</script>\n<button onclick={onsave}>{label}</button>\n`,
            'parent.abide': `<script>\nimport Child from './child.abide'\nfunction save() {}\n</script>\n<Child label="x" onsave={save} />\n`,
        })
        const parent = collectAbideDiagnostics(createShadowProgram(dir)).filter((diagnostic) =>
            diagnostic.file.endsWith('parent.abide'),
        )
        expect(parent).toHaveLength(0)
    })

    /* A missing required `on*` callback prop is still caught — completeness is enforced. */
    test('a missing required on* callback prop is caught in the parent', () => {
        const dir = project({
            'child.abide': `<script>\nimport { props } from '@abide/abide/ui/props'\nconst { label, onsave } = props<{ label: string; onsave: () => void }>()\n</script>\n<button onclick={onsave}>{label}</button>\n`,
            'parent.abide': `<script>\nimport Child from './child.abide'\n</script>\n<Child label="x" />\n`,
        })
        const parent = collectAbideDiagnostics(createShadowProgram(dir)).filter((diagnostic) =>
            diagnostic.file.endsWith('parent.abide'),
        )
        expect(parent).toHaveLength(1)
        expect(parent[0]!.message).toContain('onsave')
    })

    /* A parent-directory relative `.abide` import resolves in the shadow, so a wrong prop
       on a component imported via `../` is still caught (not a phantom "Cannot find
       module"). */
    test('a parent-relative .abide import resolves and type-checks', () => {
        const dir = project({
            'ui/Card.abide': `<script>\nimport { props } from '@abide/abide/ui/props'\nconst { title } = props<{ title: string }>()\n</script>\n<h2>{title}</h2>\n`,
            'ui/pages/page.abide': `<script>\nimport Card from '../Card.abide'\n</script>\n<Card title={42} />\n`,
        })
        const diagnostics = collectAbideDiagnostics(createShadowProgram(dir)).filter((diagnostic) =>
            diagnostic.file.endsWith('page.abide'),
        )
        expect(diagnostics).toHaveLength(1)
        expect(diagnostics[0]!.message).toContain('not assignable')
    })

    test('a page infers its route params via props() — string ops clean', () => {
        const dir = project({
            'src/ui/pages/[id]/page.abide': `<script>\nimport { props } from '@abide/abide/ui/props'\nconst { id } = props()\n</script>\n<p>{id.toUpperCase()}</p>\n`,
        })
        const diagnostics = collectAbideDiagnostics(createShadowProgram(dir)).filter((diagnostic) =>
            diagnostic.file.endsWith('page.abide'),
        )
        expect(diagnostics).toHaveLength(0)
    })

    test('a page route param is typed string — a number op is caught', () => {
        const dir = project({
            'src/ui/pages/[id]/page.abide': `<script>\nimport { props } from '@abide/abide/ui/props'\nconst { id } = props()\n</script>\n<p>{id.toFixed(2)}</p>\n`,
        })
        const diagnostics = collectAbideDiagnostics(createShadowProgram(dir)).filter((diagnostic) =>
            diagnostic.file.endsWith('page.abide'),
        )
        expect(diagnostics).toHaveLength(1)
        expect(diagnostics[0]!.message).toContain('toFixed')
    })

    /* `effect` is now an ordinary author import (`import { effect } from
       '@abide/abide/ui/effect'`) — the imported reactive surface. The old ban is lifted:
       no "compiler-internal" rejection. (The throwaway project doesn't install the package,
       so module resolution is the only remaining noise — a real consumer resolves it.) */
    test('a direct import of effect is no longer rejected as compiler-internal', () => {
        const source = `<script>\nimport { effect } from '@abide/abide/ui/effect'\neffect(() => {})\n</script>\n<p>hi</p>\n`
        const dir = project({ 'good.abide': source })
        const diagnostics = collectAbideDiagnostics(createShadowProgram(dir))
        expect(
            diagnostics.some((diagnostic) => diagnostic.message.includes('compiler-internal')),
        ).toBe(false)
        expect(
            diagnostics.some((diagnostic) => diagnostic.message.includes('scope().effect')),
        ).toBe(false)
    })

    /* The supported form is clean — no false positive on `scope().effect`. */
    test('scope().effect is not flagged', () => {
        const dir = project({
            'good.abide': `<script>\nconst stop = scope().effect(() => {})\n</script>\n<p>hi</p>\n`,
        })
        expect(collectAbideDiagnostics(createShadowProgram(dir))).toHaveLength(0)
    })

    /* An element `attach` types its `node` param from the element's tag, so the
       attachment body reads the specific DOM interface with no implicit-any noise. */
    test('an element attach types node from its tag — an input-only member is clean', () => {
        const dir = project({
            'field.abide': `<input attach={(node) => { node.value = ''; node.select() }} />\n`,
        })
        expect(collectAbideDiagnostics(createShadowProgram(dir))).toHaveLength(0)
    })

    /* The type is the SPECIFIC element, not `any`/`Element`: a member that exists on
       `HTMLInputElement` but not `HTMLDivElement` is caught when the tag is `<div>`. */
    test('an element attach node is the specific tag type — a wrong member is caught', () => {
        const source = `<div attach={(node) => { node.value }} />\n`
        const dir = project({ 'box.abide': source })
        const diagnostics = collectAbideDiagnostics(createShadowProgram(dir))
        expect(diagnostics).toHaveLength(1)
        expect(diagnostics[0]!.message).toContain('value')
        /* The squiggle lands inside the attachment expression, on the member read. */
        const span = source.slice(
            diagnostics[0]!.start,
            diagnostics[0]!.start + diagnostics[0]!.length,
        )
        expect(source).toContain(span)
        expect(span).toContain('value')
    })

    /* The attach VALUE is now checked as an attachment — a non-function is rejected
       (previously it slipped through as a bare statement). */
    test('an element attach rejects a non-function value', () => {
        const dir = project({
            'bad.abide': `<div attach={"nope"} />\n`,
        })
        const diagnostics = collectAbideDiagnostics(createShadowProgram(dir))
        expect(diagnostics).toHaveLength(1)
        expect(diagnostics[0]!.message).toContain('not assignable')
    })

    /* An unknown/custom tag falls back to `Element` — a base-interface member reads
       clean and the param is still typed (no implicit-any). */
    test('a custom-element attach falls back to Element without implicit-any', () => {
        const dir = project({
            'widget.abide': `<my-widget attach={(node) => { node.tagName }} />\n`,
        })
        expect(collectAbideDiagnostics(createShadowProgram(dir))).toHaveLength(0)
    })

    /* A type error in a plain `.ts` file (an rpc handler, `app.ts`, a `$shared` helper — here a
       mistyped assignment stands in) fails `abide check`, not only errors inside `.abide`
       templates. The `.ts` files are already in the shadow program for resolution; check now
       reports them too. A `.abide` file is present to root the project. */
    test('a type error in a .ts file fails abide check, not just .abide templates', async () => {
        const dir = project({
            'ok.abide': `<h1>hi</h1>\n`,
            'handler.ts': `export const port: number = 'not a number'\n`,
        })
        const errors = await checkAbide({ cwd: dir })
        expect(errors).toBeGreaterThanOrEqual(1)
    })

    /* The complement: a project whose `.ts` files are clean passes (the new `.ts` pass doesn't
       manufacture false errors under the shadow tsconfig's relaxed options). */
    test('a project with clean .ts files still passes abide check', async () => {
        const dir = project({
            'ok.abide': `<h1>hi</h1>\n`,
            'handler.ts': `export const port: number = 3000\n`,
        })
        const errors = await checkAbide({ cwd: dir })
        expect(errors).toBe(0)
    })
})
