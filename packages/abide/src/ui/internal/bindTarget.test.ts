// The bind taxonomy as a TABLE, plus the two substrates read against it.
//
// Before it had an owner the set was stated twice — `emitClient.genBind`'s helper ladder and
// `serverRuntime.applyBind`'s name tests — and they disagreed on `selected`. A table test is what makes
// that visible: a target either has a row here, or the two lanes are free to answer differently again.

import { describe, expect, test } from 'bun:test'
import { bindTargetKind } from './bindTarget.ts'
import { emitModuleSource, loadEmitted } from './emit.ts'

describe('bindTargetKind', () => {
    // Every target the AST documents, plus the one that used to be classified by only one lane.
    const TABLE = [
        ['element', 'element'],
        ['group', 'group'],
        ['checked', 'boolean'],
        ['selected', 'boolean'],
        ['value', 'value'],
        // An arbitrary property bind is the value form — the open-ended `bind:<prop>` case.
        ['files', 'value'],
        ['count', 'value'],
    ] as const

    for (const [name, kind] of TABLE) {
        test(`bind:${name} is the ${kind} kind`, () => {
            expect(bindTargetKind(name)).toBe(kind)
        })
    }
})

// THE DIVERGENCE THIS TABLE CLOSED. `<option bind:selected={x}>` rendered `<option selected>` on the
// server (its `checked || selected` test) while the client's ladder tested only `group`/`checked`, so
// `selected` fell through to `bindValue` and assigned `option.value = "true"` on hydrate — clobbering
// the option's own value over an SSR paint that was correct.
describe('bind:selected means the same thing in both lanes', () => {
    test('the server renders it as a boolean attribute', async () => {
        const on = await loadEmitted('<option bind:selected={acc}>x</option>')
        expect(await on.render({ acc: { get: () => true, set: () => {} } })).toBe(
            '<option selected>x</option>',
        )
        const off = await loadEmitted('<option bind:selected={acc}>x</option>')
        expect(await off.render({ acc: { get: () => false, set: () => {} } })).toBe(
            '<option>x</option>',
        )
    })

    test('the client binds the SELECTED property, not the value', () => {
        const out = emitModuleSource('<option bind:selected={acc}>x</option>')
        expect(out.client).toContain('bindBoolean')
        expect(out.client).toContain('"selected"')
        // The regression itself: the value bind must not be what a boolean target reaches for.
        expect(out.client).not.toContain('bindValue')
    })

    test('bind:checked still emits the boolean bind, naming its own property', () => {
        const out = emitModuleSource('<input type="checkbox" bind:checked={on}>')
        expect(out.client).toContain('$rt.bindBoolean')
        expect(out.client).toContain('"checked"')
    })
})
