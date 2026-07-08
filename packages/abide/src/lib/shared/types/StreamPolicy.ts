/*
Endpoint stream policy, declared once on a streaming rpc definition (ADR-0020).
`n` is the replay depth — how many retained frames a fresh reader gets before
going live, pairing with the server-side `tail` retention. Endpoint-fixed: a
late joiner can't request deeper replay than a fresh view. No runtime consumer
today (subscribableFromResponse ignores it); threaded onto the definition for
completeness and future use.
*/
export type StreamPolicy = {
    n?: number
}
