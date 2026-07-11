import { afterEach, describe, expect, test } from 'bun:test'
import { CELL_SEED } from '../src/lib/ui/runtime/CELL_SEED.ts'
import { seedStreamedResolution } from '../src/lib/ui/seedStreamedResolution.ts'

/*
ADR-0039 — the client sink for a STREAMED CHILD's late-resolving blocking async cell. Its value ships
after the body as a `{cellSeed}` streamed resolution (the head `__SSR__.cells` snapshot had already
flushed before the child's deferred render), and `seedStreamedResolution` seeds it into `CELL_SEED` —
the SAME pre-mount warm partition `__SSR__.cells` fills — so the child's cell constructs RESOLVED when
its deferred mount runs, rather than re-running. The value is stored raw (ref-json), decoded at cell
read, exactly like a head-snapshot cell.
*/

describe('ADR-0039 streamed-child cell warm-seed sink', () => {
    afterEach(() => {
        for (const key of Object.keys(CELL_SEED)) {
            delete CELL_SEED[key]
        }
    })

    test('a {cellSeed} resolution seeds CELL_SEED with the raw ref-json value', () => {
        const key = '~1products~1[id]/0:0'
        seedStreamedResolution({ cellSeed: key, value: '[["~r",0],[{"name":"x"}]]' })
        expect(CELL_SEED[key]).toBe('[["~r",0],[{"name":"x"}]]')
    })

    test('the cellSeed arm is distinct from the streaming cellKey arm', () => {
        /* cellSeed → CELL_SEED (pre-mount seed); cellKey (ADR-0035) → the streamed-cell sink. Seeding
           a cellSeed must NOT be routed to the cellKey path, so CELL_SEED holds it. */
        seedStreamedResolution({ cellSeed: 'a:0', value: '"v"' })
        expect(CELL_SEED['a:0']).toBe('"v"')
    })
})
