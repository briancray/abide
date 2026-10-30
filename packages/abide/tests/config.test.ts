// 27.10 — FILING `onConfig` INVALIDATES `config`. abide reads `config` while it boots, before the app's
// module has filed its defaults, so a memo taken then would otherwise be the one every later read
// is served — an app module reading `config()` at load sees none of its own defaults.
//
// THE REVERT: drop the two `config.invalidate()` calls from `onConfig` in `src/server/hooks.ts`; the
// read after filing answers `undefined` where `'filed'` is due, and after unfiling `'filed'` where
// `undefined` is.

import { expect, test } from 'bun:test'

import { config } from '#server/config.ts'
import { onConfig } from '#server/hooks.ts'

test('a read after filing or unfiling onConfig resolves under what is filed now — 27.10', () => {
    expect(config().PROBE_DEFAULT).toBeUndefined()
    const unfile = onConfig(() => ({ PROBE_DEFAULT: 'filed' }))
    expect(config().PROBE_DEFAULT).toBe('filed')
    unfile()
    expect(config().PROBE_DEFAULT).toBeUndefined()
})

declare module '#server/config.ts' {
    interface Config {
        PROBE_LIMIT: number
    }
}

// 27.11, 27.12 — A DEFAULT IS BUILT ON WHAT ABIDE DERIVES, and lands as the type the app declared.
// THE REVERT: hand `defaults` the environment alone; the path is built on `undefined`. Type
// `Config` as `extends Env` again and `bun run typecheck` refuses the `number` field (TS2411).
test('onConfig sees what abide derives, and a declared field keeps its type — 27.11, 27.12', () => {
    const unfile = onConfig((env) => ({
        PROBE_CACHE: `${env.APP_DATA_DIR}/cache`,
        PROBE_LIMIT: 25,
    }))
    try {
        const resolved = config()
        const limit: number = resolved.PROBE_LIMIT
        expect(limit).toBe(25)
        expect(resolved.PROBE_CACHE).toBe(`${resolved.APP_DATA_DIR}/cache`)
    } finally {
        unfile()
    }
})
