import { healthSeedSlot } from '../shared/healthSeedSlot.ts'
import { rpcTimeoutSlot } from '../shared/rpcTimeoutSlot.ts'
import { setAppName } from '../shared/setAppName.ts'
import { setBaseResolver } from '../shared/setBaseResolver.ts'
import type { SsrBootState } from '../shared/types/SsrBootState.ts'

/* Seeds every `__SSR__` boot-state field into its ambient slot. The map is typed
   EXHAUSTIVELY over `SsrBootState`, so a boot field can't be added to the payload
   without a seeder here — the compile error is what guarantees a stamped field is
   never silently dropped client-side. Base is seeded first (object-key order), as the
   prior hand-written sequence required: the cache seed that follows keys call urls
   through the base resolver. */
const SEED: { [K in keyof Required<SsrBootState>]: (value: SsrBootState[K]) => void } = {
    base: (value) => setBaseResolver(() => value ?? ''),
    app: (value) => setAppName(value),
    health: (value) => {
        healthSeedSlot.payload = value
    },
    clientTimeout: (value) => {
        rpcTimeoutSlot.ms = value
    },
}

/* Applies one seeder to its own field — generic over the key so the seeder and its
   value stay correlated (a bare `SEED[key](boot[key])` loses the correlation). */
function seedField<K extends keyof SsrBootState>(key: K, boot: SsrBootState): void {
    SEED[key](boot[key])
}

/* Seeds all boot-state slots from the payload, before mount. */
export function seedBootState(boot: SsrBootState): void {
    for (const key of Object.keys(SEED) as Array<keyof SsrBootState>) {
        seedField(key, boot)
    }
}
