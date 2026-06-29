import { describe, expect, test } from 'bun:test'

/*
withBindings-only enforcement (ADR-0013, phase 4). The set of names a block
introduces, and their classification, must flow to the back-ends through exactly
ONE layer: the plan's `bindings` registered via `withBindings`. The whole point of
the refactor is that there is no SECOND name derivation — a back-end that recomputed
the set (via `destructureBindingNames`) or registered shadows directly (via the old
`withLocalDerived`/`withLocalPlain` helpers) would reintroduce the `block-binding-shadow`
drift this designs out.

This is an architectural invariant, not a behaviour, so the cheapest honest guard is
to read each back-end's SOURCE text and assert the structural property directly: the
second-derivation calls are ABSENT and the single-source call is PRESENT. A future
edit that quietly reintroduces a parallel derivation fails here even if every render
test still passes (the drift is silent until a name collides). Reading source-as-text
in a test is acceptable precisely because the property is about the code's shape.
*/

/* The two render back-ends — the only places block bindings could be registered. */
const BACK_ENDS: string[] = ['generateBuild.ts', 'generateSSR.ts']

const backEndSource = async (file: string): Promise<string> =>
    await Bun.file(new URL(`../src/lib/ui/compile/${file}`, import.meta.url)).text()

describe('binding derivation is single-source — only withBindings registers block names', () => {
    test.each(BACK_ENDS)('%s registers bindings only through withBindings', async (file) => {
        const source = await backEndSource(file)
        // a second name derivation: re-flattening the pattern in the back-end instead of
        // letting withBindings own it.
        expect(source).not.toContain('destructureBindingNames(')
        // the pre-refactor direct shadow-registration helpers — a parallel registration path.
        expect(source).not.toContain('withLocalDerived')
        expect(source).not.toContain('withLocalPlain')
        // the one shared registration path must be present.
        expect(source).toContain('withBindings(')
    })
})
