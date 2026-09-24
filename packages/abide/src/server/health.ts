// SECTION 25 — THE ACCOUNT OF THE APP: the baseline, and every `onHealth` report merged over it with
// the app winning each collision (25.2). A report that throws or answers something that is not an
// object is left out and said so, rather than taking the account down with it.
//
// SERVER-ONLY FOR NOW. A body runs when its value is built, so a `health` in the isomorphic barrel
// would fetch `/__abide/health` on every page load whether anything read it or not; the browser's
// half is 25.3's seeding, and waits on it.

import abidePackage from '../../package.json' with { type: 'json' }
import { namedLogger } from '#shared/log.ts'
import { isRecord } from '#shared/isRecord.ts'
import { reactive } from '#shared/reactive/index.ts'
import { appIdentity, config } from './config.ts'
import { HOOKS } from './hooks.ts'

export type Health = { version: string; abide: string; startedAt: string }

const HEALTH_LOG = namedLogger('abide:health')

const STARTED_AT = new Date(performance.timeOrigin).toISOString()

export async function reportHealth(): Promise<Health> {
    await config
    const account: Record<string, unknown> = {
        version: appIdentity().version,
        abide: abidePackage.version,
        startedAt: STARTED_AT,
    }
    for (const report of HOOKS.health) {
        let answered: unknown
        try {
            answered = await report()
        } catch (thrown) {
            HEALTH_LOG.warning('an onHealth report threw', thrown)
            continue
        }
        if (!isRecord(answered)) {
            HEALTH_LOG.warning(
                'an onHealth report answered something that is not an object',
                answered,
            )
            continue
        }
        Object.assign(account, answered)
    }
    return account as Health
}

// A `ttl` of 0, so a read is the account as it stands rather than the one the first reader got.
export const health = reactive(reportHealth, { global: true, ttl: 0 })
