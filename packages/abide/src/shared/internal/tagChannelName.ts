// Client-safe cache-TAG naming (shared-cache-plan §2.4). Factored out of `memoChannels.ts` for the
// same reason `memoChannelName.ts` was: the browser mux joins these channels, and it must compute a
// name byte-identical to the one the server publishes on, without dragging server-only transport into
// the client bundle. A tag name is pure over the tag string — there are no args to canonicalize.

// Reserved `@tag:` namespace, distinct from both `@rpc:` cache channels and bare user-socket names
// (which never carry `@`/`:`). The SINGLE source of truth — `channelAuth.ts` discriminates on it
// rather than restating the literal, so the two cannot drift.
export const TAG_CHANNEL_PREFIX = '@tag:'

export function tagChannelName(tag: string): string {
    return TAG_CHANNEL_PREFIX + tag
}
