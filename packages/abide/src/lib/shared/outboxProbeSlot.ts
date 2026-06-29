/*
Internal slot the browser outbox registry registers its prober into, so the
shared pending() probe can count parked durable-rpc writes without shared/
importing browser/. Mirrors tailProbeSlot. The prober reads the doc-backed
queue entries (reactive inside scope().computed() / scope().effect()) and reports whether any
undelivered entry matches the selector: a durable rpc selector (carries a
`url`) narrows to its own queue, the bare form spans every registered queue,
optional args narrow to one parked call by structural compare. Outbox state is
pending-only — a parked write has no value, so it never contributes to
refreshing(); probeRegistries reads this slot only on its `field === 'pending'`
branch, which is why the slot mirrors tailProbeSlot but reports a bare boolean
rather than a { pending, refreshing } pair. When no prober is registered (server
render, or no durable rpc was ever used) pending() sees no parked writes,
exactly as on the server where there are no client queues.
*/
export const outboxProbeSlot: {
    probe: ((selector: unknown, args: unknown) => boolean) | undefined
} = {
    probe: undefined,
}
