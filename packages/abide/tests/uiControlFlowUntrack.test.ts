import { beforeAll, describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { computed } from '../src/lib/ui/computed.ts'
import { appendStatic } from '../src/lib/ui/dom/appendStatic.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { attr } from '../src/lib/ui/dom/attr.ts'
import { awaitBlock } from '../src/lib/ui/dom/awaitBlock.ts'
import { each } from '../src/lib/ui/dom/each.ts'
import { on } from '../src/lib/ui/dom/on.ts'
import { switchBlock } from '../src/lib/ui/dom/switchBlock.ts'
import { when } from '../src/lib/ui/dom/when.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { createDoc as doc } from '../src/lib/ui/runtime/createDoc.ts'
import { state } from '../src/lib/ui/state.ts'
import { installMiniDom } from './support/installMiniDom.ts'
import { text } from './support/reactiveText.ts'

beforeAll(() => {
    installMiniDom()
})

const NAMES = [
    'host',
    'doc',
    'state',
    'computed',
    'text',
    'appendText',
    'appendStatic',
    'attr',
    'on',
    'each',
    'when',
    'switchBlock',
    'awaitBlock',
    'effect',
]

function run(source: string, extra: Record<string, unknown> = {}): HTMLElement {
    const runtime: Record<string, unknown> = {
        doc,
        state,
        computed,
        text,
        appendText,
        appendStatic,
        attr,
        on,
        each,
        when,
        switchBlock,
        awaitBlock,
        effect,
        ...extra,
    }
    const host = document.createElement('div')
    const allNames = [...NAMES, ...Object.keys(extra).filter((key) => !NAMES.includes(key))]
    const args = allNames.map((name) => (name === 'host' ? host : runtime[name]))
    new Function(...allNames, compileComponent(source))(...args)
    return host
}

/*
A raw reactive read inside a control-flow branch (a nested `<script>import { state } from '@abide/abide/ui/state'
` body, which the
compiler does NOT wrap in its own effect) must not subscribe the builder's reconcile
effect — otherwise an unrelated change to that value re-runs the whole builder (each:
re-reconciles the list; when/switch: re-evaluates the condition). The branch build runs
untracked; only the source (`items()` / `condition()` / `subject()`) drives the builder.
*/
describe('control-flow branch builds run untracked', () => {
    test('an each row body read does not subscribe the each reconcile effect', () => {
        let sourceReads = 0
        const tracker = state(0)
        const host = run(
            `<script></script>
            <ul>{#for r of rows() by r}
                <script>tracker.value</script>
                <li>{r}</li>
            {/for}</ul>`,
            {
                rows: () => {
                    sourceReads += 1
                    return [1, 2]
                },
                tracker,
            },
        )
        expect(sourceReads).toBe(1) // built once on mount
        expect(host.textContent?.replace(/\s/g, '')).toBe('12')
        tracker.value = 1 // a value a row body read — must NOT re-reconcile
        expect(sourceReads).toBe(1)
    })

    test('a when branch body read does not subscribe the when toggle effect', () => {
        let conditionReads = 0
        const tracker = state(0)
        const show = state(false)
        run(
            `<script></script>
            {#if cond()}
                <script>tracker.value</script>
                <span>shown</span>
            {/if}`,
            {
                cond: () => {
                    conditionReads += 1
                    return show.value
                },
                tracker,
                show,
            },
        )
        show.value = true // flip → builds the then-branch INSIDE the effect (reads tracker raw)
        const settled = conditionReads
        tracker.value = 1 // must NOT wake the when effect
        expect(conditionReads).toBe(settled)
    })

    test('a switch case body read does not subscribe the switch swap effect', () => {
        let subjectReads = 0
        const tracker = state(0)
        const choice = state(1)
        run(
            `<script></script>
            {#switch subject()}
                {:case 1}<span>one</span>
                {:case 2}
                    <script>tracker.value</script>
                    <span>two</span>
            {/switch}`,
            {
                subject: () => {
                    subjectReads += 1
                    return choice.value
                },
                tracker,
                choice,
            },
        )
        choice.value = 2 // swap → builds case 2 INSIDE the effect (reads tracker raw)
        const settled = subjectReads
        tracker.value = 1 // must NOT wake the switch effect
        expect(subjectReads).toBe(settled)
    })
})
