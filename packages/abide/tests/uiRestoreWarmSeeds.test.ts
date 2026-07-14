import { afterEach, describe, expect, test } from 'bun:test'
import { encodeRefJson } from '../src/lib/shared/encodeRefJson.ts'
import { CELL_SEED } from '../src/lib/ui/runtime/CELL_SEED.ts'
import { DOC_SEED } from '../src/lib/ui/runtime/DOC_SEED.ts'
import { restoreWarmSeeds } from '../src/lib/ui/runtime/restoreWarmSeeds.ts'
import { warmSeedBackup } from '../src/lib/ui/runtime/warmSeedBackup.ts'

/*
Hydration-desync recovery hardening. The hydration pass CONSUMES the warm-seed manifests — each
adopted async-cell key is deleted from CELL_SEED, each doc consumed from DOC_SEED. When a desync then
discards the server markup and rebuilds COLD, the seeds are gone, so every blocking `await` cell would
refetch, stay pending, and throw an uncaught SuspenseSignal at mount (a dead page — the cold rebuild
runs inside the router's catch, past the try, with no suspense boundary). `restoreWarmSeeds` re-primes
the manifests from the pristine copies `startClient` stashed in `warmSeedBackup`, so the rebuilt cells
re-adopt the SSR-resolved values and read settled instead.
*/
describe('restoreWarmSeeds re-primes the consumed warm-seed manifests for the cold rebuild', () => {
    afterEach(() => {
        for (const key of Object.keys(CELL_SEED)) {
            delete CELL_SEED[key]
        }
        for (const key of Object.keys(DOC_SEED)) {
            delete DOC_SEED[key]
        }
        warmSeedBackup.cells = undefined
        warmSeedBackup.docs = undefined
    })

    test('restores the cell + doc keys the hydration pass deleted', () => {
        warmSeedBackup.cells = { '~1products:0': encodeRefJson({ value: 1 }) }
        warmSeedBackup.docs = { '~1products': encodeRefJson({ id: 'SERVER' }) }
        // Simulate a hydration pass that consumed both — CELL_SEED/DOC_SEED start empty.
        expect(CELL_SEED['~1products:0']).toBeUndefined()
        expect(DOC_SEED['~1products']).toBeUndefined()

        restoreWarmSeeds()

        expect(CELL_SEED['~1products:0']).toBe(warmSeedBackup.cells['~1products:0']!)
        expect(DOC_SEED['~1products']).toBe(warmSeedBackup.docs['~1products']!)
    })

    test('the pristine backup is not itself consumed — a second recovery still restores', () => {
        warmSeedBackup.cells = { 'k:0': encodeRefJson('v') }
        restoreWarmSeeds()
        delete CELL_SEED['k:0'] // the rebuild consumed it again
        restoreWarmSeeds()
        expect(CELL_SEED['k:0']).toBe(warmSeedBackup.cells['k:0']!)
    })

    test('a no-op when boot never seeded (a fresh client-only mount)', () => {
        restoreWarmSeeds()
        expect(Object.keys(CELL_SEED)).toHaveLength(0)
        expect(Object.keys(DOC_SEED)).toHaveLength(0)
    })
})
