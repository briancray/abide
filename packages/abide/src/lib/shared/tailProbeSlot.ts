/*
Internal slot the browser tail() registry registers its prober into, so the
shared probes (pending / refreshing) can answer for Subscribables without
shared/ importing browser/. The prober taps the registry's lifecycle channel
(reactive inside $derived / $effect) and reports one stream by source name —
spanning its latest-wins and window entries — or, with no name, whether any
registered stream matches. When no prober is registered (server render, or
tail was never imported) the probes fall back to the same answers tail()
itself gives on the server: a named stream has no value yet (pending true),
and nothing is reconnecting (refreshing false).
*/
export const tailProbeSlot: {
    probe: ((name?: string) => { pending: boolean; refreshing: boolean }) | undefined
} = {
    probe: undefined,
}
