/**
 * 16.117 — WHAT EACH KIND OF ADDRESSABLE VALUE IS WRITTEN BY OVER THE WIRE: each member, and the verb
 * it is sent with. An `rpc`'s call is its value's read, `GET`; these are the rest of its face, the
 * same members on the server, where they run in process, and on the browser's copy, where they send.
 * Read by the runtime off the value and by the build off its type.
 */
export const SOURCE_MEMBERS = {
    value: { set: 'PUT', patch: 'PATCH' },
    memo: { set: 'PUT', patch: 'PATCH', refresh: 'POST' },
    table: { set: 'PUT', patch: 'PATCH', delete: 'DELETE' },
    job: { run: 'POST' },
    pipe: { push: 'POST' },
    ledger: { append: 'POST' },
} as const
