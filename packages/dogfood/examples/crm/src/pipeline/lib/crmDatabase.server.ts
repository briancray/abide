import { database } from '@abide/abide/server'

/** The CRM's own file, which a restarted server opens on. */
export const crmDatabase = database('crm', {
    migrations: [
        // Every target set, the newest being the team's.
        `CREATE TABLE targets (
            id INTEGER PRIMARY KEY,
            target INTEGER NOT NULL,
            setAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
    ],
})
