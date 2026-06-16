/*
Server-side registration point for health()'s SSR read mark. createServer
installs a marker that flags the current request store; the renderer reads
the flag to stamp the health payload into __SSR__ only for pages that
actually read health() during their render — the same reader-driven rule as
the client poll. Browser bundles never install one, so the shared module's
call no-ops there. Mirrors requestScopeSlot.
*/
export const healthReadSlot: { mark: (() => void) | undefined } = {
    mark: undefined,
}
