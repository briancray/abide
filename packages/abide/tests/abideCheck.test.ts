import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectAbideDiagnostics } from '../src/lib/ui/compile/collectAbideDiagnostics.ts'
import { createShadowProgram } from '../src/lib/ui/compile/createShadowProgram.ts'

/* A throwaway project with the given `.abide` files and a strict tsconfig. */
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
        writeFileSync(join(dir, name), contents)
    }
    return dir
}

describe('abide check', () => {
    test('a well-typed template produces no diagnostics', () => {
        const dir = project({
            'clean.abide': `<script>\nlet title = prop<string>('title')\n</script>\n<h1>{title.toUpperCase()}</h1>\n`,
        })
        expect(collectAbideDiagnostics(createShadowProgram(dir))).toHaveLength(0)
    })

    test('a wrong member on a typed prop is caught and mapped to the expression', () => {
        const source = `<script>\nlet count = prop<number>('count')\n</script>\n<h1>{count.toUpperCase()}</h1>\n`
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
            'child.abide': `<script>\nlet label = prop<string>('label')\n</script>\n<span>{label}</span>\n`,
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
            'child.abide': `<script>\nlet open = prop<boolean>('open')\n</script>\n<span>{open}</span>\n`,
            'host.abide': `<script>\nimport Child from './child.abide'\nlet shown = state(true)\neffect(() => { console.log(shown) })\n</script>\n<Child open={shown} />\n`,
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
            'child.abide': `<script>\nlet open = prop<boolean>('open')\n</script>\n<span>{open}</span>\n`,
            'host.abide': `<script>\nimport Child from './child.abide'\nlet shown = state(0)\neffect(() => { console.log(shown) })\n</script>\n<Child open={shown} />\n`,
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
            'elseok.abide': `<script>\nlet v = prop<string | number>('v')\n</script>\n<template if={typeof v === 'string'}>{v.toUpperCase()}<template else>{v.toFixed(2)}</template></template>\n`,
        })
        expect(collectAbideDiagnostics(createShadowProgram(dir))).toHaveLength(0)
    })

    /* A template-literal-union subject narrows across an if/else and a switch the same as
       a plain literal union. Regression: inside the else child the subject kept the if's
       positive narrowing, so a compare against another member read as "no overlap" — the
       error a downstream app worked around with hand-rolled string-cast deriveds. */
    test('a template-literal union narrows across a nested if/else and a switch', () => {
        const head = `<script>\ntype LayoutKey = \`layout-\${'home' | 'about'}\`\nlet layoutKey = prop<LayoutKey>('layoutKey')\n</script>\n`
        const ifElse = project({
            'a.abide': `${head}<template if={layoutKey === 'layout-home'}>home<template else>{layoutKey === 'layout-about' ? 'a' : 'x'}</template></template>\n`,
        })
        expect(collectAbideDiagnostics(createShadowProgram(ifElse))).toHaveLength(0)
        const switched = project({
            'b.abide': `${head}<template switch={layoutKey}>\n<template case={'layout-home'}>home</template>\n<template default>{layoutKey}</template>\n</template>\n`,
        })
        expect(collectAbideDiagnostics(createShadowProgram(switched))).toHaveLength(0)
    })

    /* A real `switch` narrows the discriminant subject into each case body. */
    test('a switch case narrows a discriminated union subject', () => {
        const dir = project({
            'shape.abide': `<script>\ntype Shape = { kind: 'circle'; r: number } | { kind: 'square'; side: number }\nlet shape = prop<Shape>('shape')\n</script>\n<template switch={shape.kind}>\n  <template case={'circle'}>{shape.r}</template>\n  <template case={'square'}>{shape.side}</template>\n</template>\n`,
        })
        expect(collectAbideDiagnostics(createShadowProgram(dir))).toHaveLength(0)
    })

    /* An async each iterates with `for await`, so the item binds to the AsyncIterable's
       element type instead of erroring on the missing sync iterator. */
    test('an async each binds the AsyncIterable element type', () => {
        const dir = project({
            'stream.abide': `<script>\nlet stream = prop<AsyncIterable<number>>('stream')\n</script>\n<template each={stream} as={n} await>{n.toFixed(2)}</template>\n`,
        })
        expect(collectAbideDiagnostics(createShadowProgram(dir))).toHaveLength(0)
    })

    /* The streaming `then` branch binds the awaited value, so a wrong member on the
       resolved data is caught (previously bound as `any`, silently unchecked). */
    test('a streaming then branch type-checks the resolved value', () => {
        const dir = project({
            'await.abide': `<script>\nlet load = prop<Promise<{ title: string }>>('load')\n</script>\n<template await={load}>loading<template then={data}>{data.bogus}</template></template>\n`,
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
            'g.abide': `<script>\nlet x = state<string>()\n</script>\n<template if={x !== undefined}><span>{x.toUpperCase()}</span></template>\n`,
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
            'child.abide': `<script>\nlet label = prop<string>('label')\n</script>\n<span>{label}</span>\n`,
            'ok.abide': `<script>\nimport Child from './child.abide'\nlet on = state(true)\n</script>\n<template if={on}><Child label="x"/>plain</template>\n`,
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
            'badimport.abide': `<script>\nlet on = state(true)\n</script>\n<template if={on}>\n<script>import Heavy from './child.abide'</script>\n</template>\n`,
            'child.abide': `<script>\nlet label = prop<string>('label')\n</script>\n<span>{label}</span>\n`,
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
            'lazy.abide': `<script>\nlet p = state(Promise.resolve(1))\n</script>\n<template await={p} then={v}>\n<script>effect(() => { void import('./child.abide') })</script>\n<span>{v}</span>\n</template>\n`,
            'child.abide': `<script>\nlet label = prop<string>('label')\n</script>\n<span>{label}</span>\n`,
        })
        expect(
            collectAbideDiagnostics(createShadowProgram(dir)).filter((diagnostic) =>
                diagnostic.file.endsWith('lazy.abide'),
            ),
        ).toEqual([])
    })

    /* A nested scoped `<script>`'s bindings reach the branch's later siblings,
       including a nested if/each within the same branch (emitted inline, not in a
       trapping block that left them "Cannot find name"). */
    test('a nested-script binding reaches a deeply nested block in the branch', () => {
        const dir = project({
            'nested.abide': `<script>\nlet p = state(Promise.resolve(1))\n</script>\n<template await={p} then={v}>\n<script>const label = String(v)</script>\n<div><template if={v > 0}><span>{label}</span></template></div>\n</template>\n`,
        })
        expect(collectAbideDiagnostics(createShadowProgram(dir))).toHaveLength(0)
    })
})
