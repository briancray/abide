// The app's own name — the label of `log`'s default channel, and the namespace a bare
// `log.channel('cards')` is qualified under (`docs:cards`).
//
// Isomorphic, and the two sides learn it differently: on the SERVER `loadApp` seeds
// `ABIDE_APP_NAME` from the project's package.json at boot; in the BROWSER there is no environment
// to read, so the client build BAKES the resolved name into the loader entry as
// `__ABIDE_APP_NAME__` (`clientBundle.loaderSource`). Without that seed a browser line would label
// and gate under `abide:` while the server line for the same channel said `docs:` — one channel
// with two names, on a primitive whose whole point is being the same on both sides.
//
// Read at CALL time, never cached: framework modules build channel loggers at module load, well
// before boot seeds the name.
import { readEnv } from './readEnv.ts'

export function appName(): string {
    const fromEnv = readEnv('ABIDE_APP_NAME')
    if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv
    const fromGlobal = (globalThis as { __ABIDE_APP_NAME__?: string }).__ABIDE_APP_NAME__
    if (typeof fromGlobal === 'string' && fromGlobal.length > 0) return fromGlobal
    return 'abide'
}
