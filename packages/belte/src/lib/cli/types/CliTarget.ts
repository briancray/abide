/*
A resolved CLI connection: the server URL plus an optional bearer token, and the
child process when this is a locally-spawned instance — the session owns that
child and reaps it on disconnect/exit.
*/
export type CliTarget = {
    url: string
    token?: string
    child?: ReturnType<typeof Bun.spawn>
    // The app's name from its identity probe, when already fetched while resolving
    // the target — lets the status line print it without re-probing.
    name?: string
}
