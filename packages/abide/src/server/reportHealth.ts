// SECTION 25 — THE ACCOUNT OF THE APP: the baseline, and every `onHealth` report merged over it with
// the app winning each collision (25.2). A report that throws or answers something that is not an
// object is left out and said so, rather than taking the account down with it.
//
// What `health` reports through on a server: `installServer` fills `HEALTH` with it.

import type { Health } from '#shared/health.ts'
import { isRecord } from '#shared/isRecord.ts'
import { namedLogger } from '#shared/log.ts'
import abidePackage from '../../package.json' with { type: 'json' }
import { appIdentity, config } from './config.ts'
import { HOOKS, inOrder } from './hooks.ts'

const HEALTH_LOG = namedLogger('abide:health')

const STARTED_AT = new Date(performance.timeOrigin).toISOString()

/** The account of the app: the baseline with every `onHealth` report merged over it. */
export async function reportHealth(): Promise<Health> {
    await config
    const account: Record<string, unknown> = {
        version: appIdentity().version,
        abide: abidePackage.version,
        startedAt: STARTED_AT,
    }
    for (const report of inOrder(HOOKS.health)) {
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
    // Through `unknown`: the fields an app merges into `Health` (25.4) are its reports' to supply,
    // and a record the checker can see none of them in is not one it will narrow to the account.
    return account as unknown as Health
}
