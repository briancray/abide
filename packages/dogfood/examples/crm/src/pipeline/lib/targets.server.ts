import { table, type Tables } from '@abide/abide/server'

import { crmDatabase } from './crmDatabase.server.ts'

/** One target the team set, typed by the migration that made its table. */
export type Target = Tables<typeof crmDatabase>['targets']

/** Every target the team has set, read by calling it. */
export const targets = table(crmDatabase, 'targets')
