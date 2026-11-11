import { database } from '@abide/abide/server'

/** The CRM's own file, which a restarted server opens on. */
export const crmDatabase = database('crm', {
    migrations: [
        // One row, which each set replaces.
        `CREATE TABLE team (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            target INTEGER
        )`,
    ],
})
