/**
 * The members every selection answers, narrowed by a pattern where the value is keyed.
 *
 * 13.4. The one list both forwarders read: a `Keyed` forwarded per scope (`scoped.ts`) and an
 * `Rpc` handing them to its handler (`rpc.ts`).
 */
export const SELECTION_MEMBERS = [
    'busy',
    'ready',
    'refresh',
    'invalidate',
] as const
