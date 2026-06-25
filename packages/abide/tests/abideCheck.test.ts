import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { collectAbideDiagnostics } from '../src/lib/ui/compile/collectAbideDiagnostics.ts'
import { createShadowProgram } from '../src/lib/ui/compile/createShadowProgram.ts'

/* A throwaway project with the given `.abide` files (paths may be nested) and a strict
   tsconfig. */
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

describe('abide check', () => {
    test('a well-typed template produces no diagnostics', () => {
        const dir = project({
            'clean.abide': `<script>\nconst { title } = props<{ title: string }>()\n</script>\n<h1>{title.toUpperCase()}</h1>\n`,
        })
        expect(collectAbideDiagnostics(createShadowProgram(dir))).toHaveLength(0)
    })

    test('a wrong member on a typed prop is caught and mapped to the expression', () => {
        const source = `<script>\nconst { count } = props<{ count: number }>()\n</script>\n<h1>{count.toUpperCase()}</h1>\n`
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

    test('a wrong prop type on a child component is caught in the parent', () => {
        const dir = project({
            'child.abide': `<script>\nconst { label } = props<{ label: string }>()\n</script>\n<span>{label}</span>\n`,
            'parent.abide': `<script>\nimport Child from './child.abide'\n</script>\n<Child label={42} />\n`,
        })
        const diagnostics = collectAbideDiagnostics(createShadowProgram(dir))
        const parent = diagnostics.filter((diagnostic) => diagnostic.file.endsWith('parent.abide'))
        expect(parent).toHaveLength(1)
        expect(parent[0]!.message).toContain('not assignable')
    })

    test('a call statement with no trailing semicolon does not merge into the next component', () => {
        /* The script's last statement is a call (`effect(...)`) left unterminated, and
           the template starts with a prop-bearing component — whose shadow emission
           begins with `(`. Without a defensive separator the two merge across the
           newline into `effect(...)(...)`, a spurious "not callable" on the author's
           effect. The child prop is well-typed, so the only possible diagnostic is the
           bug; expect none. */
        const dir = project({
            'child.abide': `<script>\nconst { open } = props<{ open: boolean }>()\n</script>\n<span>{open}</span>\n`,
            'host.abide': `<script>\nimport Child from './child.abide'\nlet shown = scope().state(true)\neffect(() => { console.log(shown) })\n</script>\n<Child open={shown} />\n`,
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
            'child.abide': `<script>\nconst { open } = props<{ open: boolean }>()\n</script>\n<span>{open}</span>\n`,
            'host.abide': `<script>\nimport Child from './child.abide'\nlet shown = scope().state(0)\neffect(() => { console.log(shown) })\n</script>\n<Child open={shown} />\n`,
        })
        const diagnostics = collectAbideDiagnostics(createShadowProgram(dir)).filter((diagnostic) =>
            diagnostic.file.endsWith('host.abide'),
        )
        expect(diagnostics).toHaveLength(1)
        expect(diagnostics[0]!.message).toContain('not assignable')
    })

    /* The `<template else>` is a CHILD of the `<template if>` (the canonical syntax the
       runtime pairs — see `generateIf`), emitted as a real `if (…) {…} else {…}`, so its
       body carries the condition's NEGATIVE narrowing — here `v` is `number` in the else,
       not the union. Regression: the else child was emitted inside the `if` block and got
       the positive narrowing, so `toFixed` errored on the narrowed `string`. */
    test('a nested else child carries the condition negative narrowing', () => {
        const dir = project({
            'elseok.abide': `<script>\nconst { v } = props<{ v: string | number }>()\n</script>\n{#if typeof v === 'string'}{v.toUpperCase()}{:else}{v.toFixed(2)}{/if}\n`,
        })
        expect(collectAbideDiagnostics(createShadowProgram(dir))).toHaveLength(0)
    })

    /* An `<template elseif>` compiles to a real `else if`, so its body inherits the prior
       conditions' negative narrowing plus its own positive — here the discriminant lands
       each branch on the right union member, so every member access is well-typed. */
    test('an elseif branch carries the correct discriminated narrowing', () => {
        const dir = project({
            'shape.abide': `<script>\nconst { s } = props<{ s: { k: 'circle'; r: number } | { k: 'square'; side: number } | { k: 'none' } }>()\n</script>\n{#if s.k === 'circle'}{s.r}{:else if s.k === 'square'}{s.side}{:else}none{/if}\n`,
        })
        expect(collectAbideDiagnostics(createShadowProgram(dir))).toHaveLength(0)
    })

    /* The same chain, but the elseif body reads a member that only exists on a DIFFERENT
       member — proof the branch is narrowed to `square`, not the widened union. */
    test('a wrong member inside an elseif branch is caught', () => {
        const dir = project({
            'shapebad.abide': `<script>\nconst { s } = props<{ s: { k: 'circle'; r: number } | { k: 'square'; side: number } }>()\n</script>\n{#if s.k === 'circle'}{s.r}{:else if s.k === 'square'}{s.r}{/if}\n`,
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
        const head = `<script>\ntype LayoutKey = \`layout-\${'home' | 'about'}\`\nconst { layoutKey } = props<{ layoutKey: LayoutKey }>()\n</script>\n`
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
            'shape.abide': `<script>\ntype Shape = { kind: 'circle'; r: number } | { kind: 'square'; side: number }\nconst { shape } = props<{ shape: Shape }>()\n</script>\n{#switch shape.kind}\n  {:case 'circle'}{shape.r}\n  {:case 'square'}{shape.side}\n{/switch}\n`,
        })
        expect(collectAbideDiagnostics(createShadowProgram(dir))).toHaveLength(0)
    })

    /* An async each iterates with `for await`, so the item binds to the AsyncIterable's
       element type instead of erroring on the missing sync iterator. */
    test('an async each binds the AsyncIterable element type', () => {
        const dir = project({
            'stream.abide': `<script>\nconst { stream } = props<{ stream: AsyncIterable<number> }>()\n</script>\n{#for await n of stream}{n.toFixed(2)}{/for}\n`,
        })
        expect(collectAbideDiagnostics(createShadowProgram(dir))).toHaveLength(0)
    })

    /* The streaming `then` branch binds the awaited value, so a wrong member on the
       resolved data is caught (previously bound as `any`, silently unchecked). */
    test('a streaming then branch type-checks the resolved value', () => {
        const dir = project({
            'await.abide': `<script>\nconst { load } = props<{ load: Promise<{ title: string }> }>()\n</script>\n{#await load}loading{:then data}{data.bogus}{/await}\n`,
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
            'g.abide': `<script>\nlet x = state<string>()\n</script>\n{#if x !== undefined}<span>{x.toUpperCase()}</span>{/if}\n`,
        })
        expect(collectAbideDiagnostics(createShadowProgram(guarded))).toHaveLength(0)

        const unguarded = project({
            'u.abide': `<script>\nlet x = state<string>()\n</script>\n<span>{x.toUpperCase()}</span>\n`,
        })
        const diagnostics = collectAbideDiagnostics(createShadowProgram(unguarded))
        expect(diagnostics).toHaveLength(1)
        expect(diagnostics[0]!.message).toContain('possibly')
    })

    /* The full range model accepts any branch content, including a component plus
       static text directly in a branch — type-checks clean. */
    test('check accepts a component and text directly in a control-flow branch', () => {
        const dir = project({
            'child.abide': `<script>\nconst { label } = props<{ label: string }>()\n</script>\n<span>{label}</span>\n`,
            'ok.abide': `<script>\nimport Child from './child.abide'\nlet on = scope().state(true)\n</script>\n{#if on}<Child label="x"/>plain{/if}\n`,
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
            'badimport.abide': `<script>\nlet on = scope().state(true)\n</script>\n{#if on}\n<script>import Heavy from './child.abide'</script>\n{/if}\n`,
            'child.abide': `<script>\nconst { label } = props<{ label: string }>()\n</script>\n<span>{label}</span>\n`,
        })
        const diagnostics = collectAbideDiagnostics(createShadowProgram(dir)).filter((diagnostic) =>
            diagnostic.file.endsWith('badimport.abide'),
        )
        expect(diagnostics).toHaveLength(1)
        expect(diagnostics[0]!.message).toContain('leading <script>')
    })

    /* A dynamic `import()` in a nested script is the legitimate lazy path — not flagged. */
    test('a dynamic import in a nested script is allowed', () => {
        const dir = project({
            'lazy.abide': `<script>\nlet p = scope().state(Promise.resolve(1))\n</script>\n{#await p then v}\n<script>effect(() => { void import('./child.abide') })</script>\n<span>{v}</span>\n{/await}\n`,
            'child.abide': `<script>\nconst { label } = props<{ label: string }>()\n</script>\n<span>{label}</span>\n`,
        })
        expect(
            collectAbideDiagnostics(createShadowProgram(dir)).filter((diagnostic) =>
                diagnostic.file.endsWith('lazy.abide'),
            ),
        ).toEqual([])
    })

    /* `scope()` is the authored reactive surface, so it must resolve in the shadow:
       a captured handle (`const s = scope()`) and capability calls (`s.undo()`) are
       emitted verbatim and need the real `Scope` type; reactive declarations
       (`scope().state/.computed`) are projected to their value type. Regression for the
       shadow preamble missing the `scope` import after the doc→scope migration. */
    test('scope() resolves — handle, capability calls, and reactive declarations type-check', () => {
        const dir = project({
            'scoped.abide': `<script>\nconst s = scope()\nconst count = scope().state(0)\nconst doubled = scope().computed(() => count * 2)\nfunction undo() { s.undo() }\n</script>\n<button onclick={undo}>{count} {doubled}</button>\n`,
        })
        expect(collectAbideDiagnostics(createShadowProgram(dir))).toHaveLength(0)
    })

    /* `const {…} = props<Shape>()` types each binding from `Shape`: a clean read
       type-checks, a `= default` narrows, and the shape is the parent-facing prop type
       so a wrong-typed prop on a child is still caught in the parent. */
    test('a typed props() destructure checks its bindings and the parent prop', () => {
        const clean = project({
            'card.abide': `<script>\nconst { lang = 'ts', code } = props<{ lang?: string; code: string }>()\n</script>\n<pre data-lang={lang.toUpperCase()}>{code}</pre>\n`,
        })
        expect(collectAbideDiagnostics(createShadowProgram(clean))).toHaveLength(0)

        const badMember = project({
            'card.abide': `<script>\nconst { lang = 'ts' } = props<{ lang?: string }>()\n</script>\n<pre>{lang.toFixed(2)}</pre>\n`,
        })
        const memberDiagnostics = collectAbideDiagnostics(createShadowProgram(badMember))
        expect(memberDiagnostics).toHaveLength(1)
        expect(memberDiagnostics[0]!.message).toContain('toFixed')

        const badParent = project({
            'card.abide': `<script>\nconst { code } = props<{ code: string }>()\n</script>\n<pre>{code}</pre>\n`,
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
            'nested.abide': `<script>\nlet p = scope().state(Promise.resolve(1))\n</script>\n{#await p then v}\n<script>const label = String(v)</script>\n<div>{#if v > 0}<span>{label}</span>{/if}</div>\n{/await}\n`,
        })
        expect(collectAbideDiagnostics(createShadowProgram(dir))).toHaveLength(0)
    })

    /* A missing REQUIRED child prop is caught in the parent — the mount must demand the
       component's full prop shape, not just check the props that were supplied. */
    test('a missing required child prop is caught in the parent', () => {
        const dir = project({
            'child.abide': `<script>\nconst { label } = props<{ label: string }>()\n</script>\n<span>{label}</span>\n`,
            'parent.abide': `<script>\nimport Child from './child.abide'\n</script>\n<Child />\n`,
        })
        const parent = collectAbideDiagnostics(createShadowProgram(dir)).filter((diagnostic) =>
            diagnostic.file.endsWith('parent.abide'),
        )
        expect(parent).toHaveLength(1)
        expect(parent[0]!.message).toContain('label')
    })

    /* An unknown/excess child prop is caught in the parent — a typo'd prop name should
       not pass silently. */
    test('an excess unknown child prop is caught in the parent', () => {
        const dir = project({
            'child.abide': `<script>\nconst { label } = props<{ label: string }>()\n</script>\n<span>{label}</span>\n`,
            'parent.abide': `<script>\nimport Child from './child.abide'\n</script>\n<Child label="x" bogusProp={1} />\n`,
        })
        const parent = collectAbideDiagnostics(createShadowProgram(dir)).filter((diagnostic) =>
            diagnostic.file.endsWith('parent.abide'),
        )
        expect(parent).toHaveLength(1)
        expect(parent[0]!.message).toContain('bogusProp')
    })

    /* A parent-directory relative `.abide` import resolves in the shadow, so a wrong prop
       on a component imported via `../` is still caught (not a phantom "Cannot find
       module"). */
    test('a parent-relative .abide import resolves and type-checks', () => {
        const dir = project({
            'ui/Card.abide': `<script>\nconst { title } = props<{ title: string }>()\n</script>\n<h2>{title}</h2>\n`,
            'ui/pages/page.abide': `<script>\nimport Card from '../Card.abide'\n</script>\n<Card title={42} />\n`,
        })
        const diagnostics = collectAbideDiagnostics(createShadowProgram(dir)).filter((diagnostic) =>
            diagnostic.file.endsWith('page.abide'),
        )
        expect(diagnostics).toHaveLength(1)
        expect(diagnostics[0]!.message).toContain('not assignable')
    })
})
