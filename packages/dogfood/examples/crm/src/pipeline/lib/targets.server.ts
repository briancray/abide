import { table } from '@abide/abide/server'

import { crmDatabase } from './crmDatabase.server.ts'

/** One target the team set. */
export type Target = { id: number; target: number; setAt: string }

/** Every target the team has set, read by calling it. */
export const targets = table<Target>(crmDatabase, 'targets')
