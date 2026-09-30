/**
 * Where the isomorphic core hands an unexpected error to `onError`, as a slot the server fills.
 *
 * 12.6 — filled by `#server/hooks.ts` with the `onError` hooks and nothing else: the core warns on
 * its own namespace, so the lifecycle log is not written a second time. A leaf, for `RPC_SERVER`'s
 * reason: the reactive core reports through it and a browser bundle must not reach what fills it.
 * `null` in a browser, which has no `onError`.
 */
export const UNEXPECTED: { report: ((error: unknown) => void) | null } = {
    report: null,
}
