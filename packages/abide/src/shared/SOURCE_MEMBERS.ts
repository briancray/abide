/**
 * 16.117 — WHAT EACH KIND OF ADDRESSABLE VALUE IS WRITTEN BY OVER THE WIRE: each member, and the verb
 * it is sent with. An `rpc`'s call is its value's read, `GET`; these are the rest of its face, the
 * same members on the server, where they run in process, and on the browser's copy, where they send.
 * Read by the runtime off the value and by the build off its type.
 *
 * 16.111 — `written` is whether the kind answers its members' verbs with no `methods` declared. A plain
 * value is configuration and a memo a computation of the server's data, so each answers its read
 * alone until `methods` names the writes; `methods` may name any verb here either way (16.112).
 */
export const SOURCE_MEMBERS = {
    value: { written: false, members: { set: 'PUT', patch: 'PATCH' } },
    memo: {
        written: false,
        members: { set: 'PUT', patch: 'PATCH', refresh: 'POST' },
    },
    table: {
        written: true,
        members: { set: 'PUT', patch: 'PATCH', delete: 'DELETE' },
    },
    job: { written: true, members: { run: 'POST' } },
    pipe: { written: true, members: { push: 'POST' } },
    ledger: { written: true, members: { append: 'POST' } },
} as const
