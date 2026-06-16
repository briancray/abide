/*
One-shot handoff of the SSR-stamped health payload (__SSR__.health) from
startClient to the shared health module. startClient writes it before
hydrate; health()'s first subscriber consumes it, applying the fields
without the immediate first probe — the document's arrival just proved the
server reachable, so the first poll waits a full interval. A slot rather
than a second export on health.ts keeps the seeding one-way and the module
single-callable. Mirrors healthReadSlot, its server half.
*/
export const healthSeedSlot: { payload: Record<string, unknown> | undefined } = {
    payload: undefined,
}
