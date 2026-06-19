/*
The durable backend `persist` writes a document snapshot to. Deliberately tiny
and synchronous — `load` must return the saved value in time to seed the doc
before first render, which a sync store (localStorage) gives for free. Inject a
custom one for a different backend (a test memory store; a server data-dir store);
an async backend (IndexedDB) needs an async-boot wrapper, out of this contract.
*/
export type PersistenceStore = {
    load: (key: string) => unknown
    save: (key: string, snapshot: unknown) => void
    remove: (key: string) => void
}
