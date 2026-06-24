import { describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'

/* The same component written with {#…} and with <template> must compile identically —
   the block grammar is a pure parser change over an unchanged AST. */
const SCRIPT = `<script>
    let on = scope().state(true)
    let items = scope().state(['x', 'y'])
    let status = scope().state('shipped')
</script>`

const PAIRS: { block: string; directive: string }[] = [
    {
        block: `{#if on}<span>ON</span>{:else}<span>OFF</span>{/if}`,
        directive: `<template if={on}><span>ON</span><template else><span>OFF</span></template></template>`,
    },
    {
        block: `<ul>{#for it of items by it}<li>{it}</li>{/for}</ul>`,
        directive: `<ul><template each={items} as="it" key="it"><li>{it}</li></template></ul>`,
    },
    {
        /* single-quote the case value so its match expression (`'shipped'`) is byte-identical
           to the directive's `case="'shipped'"` — the two lower to the same code. */
        block: `{#switch status}{:case 'shipped'}<b>S</b>{:default}<b>?</b>{/switch}`,
        directive: `<template switch={status}><template case="'shipped'"><b>S</b></template><template default><b>?</b></template></template>`,
    },
]

describe('block ↔ directive parity', () => {
    for (const { block, directive } of PAIRS) {
        test(`compileComponent parity: ${block.slice(0, 24)}`, () => {
            expect(compileComponent(`${SCRIPT}${block}`)).toBe(
                compileComponent(`${SCRIPT}${directive}`),
            )
        })
        test(`compileSSR parity: ${block.slice(0, 24)}`, () => {
            expect(compileSSR(`${SCRIPT}${block}`)).toBe(compileSSR(`${SCRIPT}${directive}`))
        })
    }
})
