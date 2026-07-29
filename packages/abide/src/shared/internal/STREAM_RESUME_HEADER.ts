// The RESPONSE half of the stream-resume protocol: whether a `?__abide_from=<n>` request was answered
// from the retained transcript, or had to run the source again from 0.
//
// The REQUEST half already has an owner — `RPC_QUERY_PARAMS.from`, read by `rpcUrl` and the router —
// and this half did not, which is what makes the asymmetry visible rather than arguable: the router
// set the two values as bare literals and `bootstrap` compared against a third copy of one of them.
//
// The values are the protocol, not decoration. `live` means the client may KEEP what it has already
// rendered and append; `fresh` means the transcript was evicted, the source is running again from
// chunk 0, and the client must REPLACE. Getting that comparison wrong duplicates or drops rows with no
// error anywhere — a mistyped literal simply never matches, and the client silently takes the
// keep-and-append branch for a response that is a full re-run.
export const STREAM_RESUME_HEADER = 'x-abide-stream-resume'

export const STREAM_RESUME = {
    // Replayed from the retained transcript at the requested offset, then continued live.
    live: 'live',
    // No usable transcript — a fresh run from 0. The client REPLACES rather than appends.
    fresh: 'fresh',
} as const
