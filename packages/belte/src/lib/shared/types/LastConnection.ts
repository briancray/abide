/*
The launcher/CLI-owned record of the last connection, kept in the data dir so it
survives relaunch and is readable before any window or session opens. It records
the *intent*, not a concrete embedded URL — an embedded server picks a fresh port
each launch, so only `{ kind: 'embedded' }` is durable; a remote connection keeps
its url. resolveLaunchTarget / resolveCliTarget read it; /connect and /start write
it; /disconnect clears it.
*/
export type LastConnection = { kind: 'embedded' } | { kind: 'url'; url: string }
