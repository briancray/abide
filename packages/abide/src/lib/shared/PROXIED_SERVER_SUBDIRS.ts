/*
Single source of truth for the proxied/server-only split. These are the only
subdirectories under src/server/ whose modules the client bundle replaces with
proxy stubs instead of shipping their real source: src/server/rpc (each
HTTP-method handler → remoteProxy) and src/server/sockets (each socket
declaration → socketProxy). Every OTHER module under src/server/ is server-only
and must never reach the browser bundle.

Expressed as bare `src/server/`-relative segments so each caller joins them
against its own base — the resolver plugin against the absolute serverDir, the
dev orchestrator's changeAffectsClient against the `server/` string prefix —
rather than re-spelling the set. Adding a proxied directory is one edit here and
both side-classifiers move in lockstep.
*/
export const PROXIED_SERVER_SUBDIRS = ['rpc', 'sockets'] as const
