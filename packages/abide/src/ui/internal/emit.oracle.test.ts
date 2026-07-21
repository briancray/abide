// EMIT REGRESSION SNAPSHOT ORACLE (Stage 1).
//
// The interpreters proved parity with the emitter (PR4 oracle, PR6, PR7, the real-browser lane) and
// were deleted at cutover (PR8). This file keeps the full fixture corpus as a REGRESSION guard over
// the AOT emitter itself: every fixture's emitted server HTML and post-mount client DOM (before and
// after any interaction) is snapshotted, so a future change to the emitter that alters output fails
// loudly. There is no interpreter reference — the snapshots ARE the reference.
//
// `throws` fixtures assert the emitted render/mount rejects/throws as expected instead of snapshotting.

import { describe, expect, test } from 'bun:test'
import { state } from '../state.ts'
import { watch } from '../watch.ts'
import { loadEmitted } from './emit.ts'
import { FIXTURES, type Fixture } from './emitFixtures.ts'

// The merged `$scope` for a script fixture — mirrors the page scope `pages.ts` builds (imports +
// framework bindings). Template fixtures carry an explicit `scope` factory.
function scriptScope(fixture: Fixture): Record<string, unknown> {
    const props = fixture.props ? fixture.props() : {}
    const imports = fixture.imports ? fixture.imports() : {}
    return { ...imports, state, watch, props: () => props }
}

function scopeFor(fixture: Fixture): Record<string, unknown> {
    if (fixture.kind === 'script') return scriptScope(fixture)
    const scope = fixture.scope
    if (scope === undefined) throw new Error('a template fixture must carry a scope factory')
    return scope()
}

// ---------------------------------------------------------------------------
// Server output — emitted HTML is stable per fixture.
// ---------------------------------------------------------------------------

describe('emit regression — server output', () => {
    for (const fixture of FIXTURES) {
        if (fixture.server === false) continue
        test(fixture.name, async () => {
            const emitted = await loadEmitted(fixture.src)
            if (fixture.throws) {
                await expect(emitted.render(scopeFor(fixture))).rejects.toThrow(fixture.throws)
                return
            }
            expect(await emitted.render(scopeFor(fixture))).toMatchSnapshot()
        })
    }
})

// ---------------------------------------------------------------------------
// Client DOM — emitted mount output is stable, before and after interaction.
// ---------------------------------------------------------------------------

describe('emit regression — client DOM', () => {
    for (const fixture of FIXTURES) {
        if (fixture.client === false) continue
        test(fixture.name, async () => {
            const emitted = await loadEmitted(fixture.src)
            if (fixture.throws) {
                const host = document.createElement('div')
                expect(() => emitted.mount(host, scopeFor(fixture))).toThrow(fixture.throws)
                return
            }
            const scope = scopeFor(fixture)
            const host = document.createElement('div')
            emitted.mount(host, scope)
            expect(host.innerHTML).toMatchSnapshot()
            if (fixture.interact) {
                await fixture.interact(host, scope)
                expect(host.innerHTML).toMatchSnapshot()
            }
        })
    }
})
