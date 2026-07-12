import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { logTapSlot } from '../src/lib/shared/logTapSlot.ts'
import type { LogRecord } from '../src/lib/shared/types/LogRecord.ts'
import { assertClaimedText } from '../src/lib/ui/dom/assertClaimedText.ts'
import { attr } from '../src/lib/ui/dom/attr.ts'
import { RENDER } from '../src/lib/ui/runtime/RENDER.ts'
import { installMiniDom } from './support/installMiniDom.ts'

/*
The path-addressed hydration-divergence signal (the `hydrate` DEBUG channel). Default (channel
off): the claim asserts still throw hard, so the router's cold-recovery path is unchanged — proven
by uiHydrateRecovery. Channel on (`DEBUG=hydrate`): a TEXT divergence warns and CONTINUES so one
reload surfaces every mismatch, and an ATTRIBUTE divergence — otherwise invisible, since `attr`
always overwrites — warns too. The write behavior itself never changes.
*/
beforeAll(() => {
    installMiniDom()
})

let records: LogRecord[] = []
beforeEach(() => {
    records = []
    logTapSlot.tap = (record) => {
        records.push(record)
    }
})
afterEach(() => {
    logTapSlot.tap = undefined
    RENDER.hydration = undefined
    delete process.env.DEBUG
})

const hydrateWarnings = (): LogRecord[] => records.filter((record) => record.channel === 'hydrate')

describe('hydration divergence reporting', () => {
    test('channel off: a text mismatch throws the hard guard (default)', () => {
        const node = document.createTextNode('server')
        expect(() => assertClaimedText(node as unknown as Text, 'client')).toThrow(
            'hydration desync',
        )
        expect(hydrateWarnings()).toHaveLength(0)
    })

    test('channel on: a text mismatch warns and does not throw', () => {
        process.env.DEBUG = 'hydrate'
        const node = document.createTextNode('server text')
        expect(() => assertClaimedText(node as unknown as Text, 'client text')).not.toThrow()
        const warnings = hydrateWarnings()
        expect(warnings).toHaveLength(1)
        expect(warnings[0]!.level).toBe('warn')
        expect(warnings[0]!.msg).toContain('text desync')
    })

    test('channel on: a divergent attribute during hydration warns, and still overwrites', () => {
        process.env.DEBUG = 'hydrate'
        const element = document.createElement('div')
        element.setAttribute('title', 'server')
        RENDER.hydration = { next: new Map() }
        attr(element, 'title', () => 'client')
        RENDER.hydration = undefined
        const warnings = hydrateWarnings()
        expect(warnings.some((record) => record.msg.includes('attr "title" desync'))).toBe(true)
        // The overwrite behavior is unchanged — the client value still lands.
        expect(element.getAttribute('title')).toBe('client')
    })

    test('channel on: a matching attribute during hydration does not warn', () => {
        process.env.DEBUG = 'hydrate'
        const element = document.createElement('div')
        element.setAttribute('title', 'same')
        RENDER.hydration = { next: new Map() }
        attr(element, 'title', () => 'same')
        RENDER.hydration = undefined
        expect(hydrateWarnings()).toHaveLength(0)
    })

    test('a divergent attribute outside hydration never warns (normal render)', () => {
        process.env.DEBUG = 'hydrate'
        const element = document.createElement('div')
        element.setAttribute('title', 'server')
        // RENDER.hydration stays undefined — a normal (non-hydrating) bind.
        attr(element, 'title', () => 'client')
        expect(hydrateWarnings()).toHaveLength(0)
    })
})
