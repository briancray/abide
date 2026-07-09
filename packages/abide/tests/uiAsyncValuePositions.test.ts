import { beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { classifyInterpolationType } from '../src/lib/ui/compile/classifyInterpolationType.ts'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { createShadowProgram } from '../src/lib/ui/compile/createShadowProgram.ts'
import { nodeAtShadowOffset } from '../src/lib/ui/compile/nodeAtShadowOffset.ts'
import { shadowNaming } from '../src/lib/ui/compile/shadowNaming.ts'
import { sourceToShadowOffset } from '../src/lib/ui/compile/sourceToShadowOffset.ts'
import type { InterpolationClassifier } from '../src/lib/ui/compile/types/InterpolationClassifier.ts'
import { installMiniDom } from './support/installMiniDom.ts'
import { settle } from './support/settle.ts'

/* A shadow-backed classifier over a component source written to a throwaway on-disk project —
   the same wiring `typeDirectedInterpolation.test` uses, so a bare async function in the script
   classifies as a promise and its value-position read lifts to a peek-cell. */
function makeClassifier(source: string): InterpolationClassifier {
    const dir = mkdtempSync(join(tmpdir(), 'abide-asyncpos-'))
    writeFileSync(
        join(dir, 'tsconfig.json'),
        JSON.stringify({
            compilerOptions: {
                strict: true,
                module: 'esnext',
                moduleResolution: 'bundler',
                target: 'esnext',
                lib: ['esnext', 'dom'],
            },
        }),
    )
    const abidePath = join(dir, 'Component.abide')
    writeFileSync(abidePath, source)
    const { program, shadows } = createShadowProgram(dir, [abidePath])
    const checker = program.getTypeChecker()
    const shadow = shadows.get(abidePath)!
    const shadowFile = program.getSourceFile(shadowNaming.suffixed(abidePath))!
    return (loc, code) => {
        const offset = sourceToShadowOffset(shadow.mappings, loc)
        if (offset === undefined) {
            return 'sync'
        }
        const node = nodeAtShadowOffset(shadowFile, offset, code.length)
        if (node === undefined) {
            return 'sync'
        }
        return classifyInterpolationType(checker.getTypeAtLocation(node), node, checker)
    }
}

/* Compiles WITH a classifier (so the async read lifts) and mounts the client body. The abide-ui
   runtime helpers (`$$scope`, `$$readCell`, `$$when`, `$$each`, `$$appendText`, …) resolve to the
   real modules via the `uiPreload` globals, so only `host` is a free binding. Returns the host. */
function mount(source: string): HTMLElement {
    const classify = makeClassifier(source)
    const body = compileComponent(source, false, undefined, undefined, classify)
    const host = document.createElement('div')
    new Function('host', body)(host)
    return host
}

/*
ADR-0032 D3: a lifted async value-position read peeks `undefined` WHILE PENDING — every position
renders its natural empty state (never a throw, so loading ≠ error) and fills in on resolve. These
mount with an inline async function (pending at mount, resolved after the microtask drain `settle`
flushes), asserting BOTH the pending render (synchronously, before settle) and the resolved render.
*/
beforeAll(() => {
    installMiniDom()
})

describe('ADR-0032 async value positions render pending-undefined then resolve', () => {
    test('{#if getFoo()} renders the ELSE branch while pending, the THEN branch after resolve', async () => {
        const host = mount(
            `<script>\nasync function getFoo() { return true }\n</script>\n{#if getFoo()}<span>THEN</span>{:else}<span>ELSE</span>{/if}\n`,
        )
        /* Pending: the peek is `undefined` (falsy) → the else branch. Loading is not an error. */
        expect(host.textContent).toContain('ELSE')
        expect(host.textContent).not.toContain('THEN')
        await settle()
        /* Resolved truthy → the then branch. */
        expect(host.textContent).toContain('THEN')
        expect(host.textContent).not.toContain('ELSE')
    })

    test("{getFoo() ?? 'Loading...'} renders the fallback while pending, the value after resolve", async () => {
        const host = mount(
            `<script>\nasync function getFoo() { return 'DONE' }\n</script>\n<p>{getFoo() ?? 'Loading...'}</p>\n`,
        )
        /* Pending: `undefined ?? 'Loading...'` → the fallback (the `??` composes on the peek). */
        expect(host.textContent).toContain('Loading...')
        await settle()
        expect(host.textContent).toContain('DONE')
        expect(host.textContent).not.toContain('Loading...')
    })

    test('{#for x of getRows()} renders an empty list while pending, the rows after resolve', async () => {
        const host = mount(
            `<script>\nasync function getRows() { return ['a', 'b'] }\n</script>\n<ul>{#for x of getRows()}<li>{x}</li>{/for}</ul>\n`,
        )
        /* Pending: the peek is `undefined` → an empty list (no throw). */
        expect(host.textContent).toBe('')
        await settle()
        expect(host.textContent).toBe('ab')
    })
})
