// @ts-expect-error virtual module resolved by abideResolverPlugin
import * as appMod from './_virtual/app.ts'
// @ts-expect-error virtual module resolved by abideResolverPlugin
import { appInfo } from './_virtual/app-info.ts'
// @ts-expect-error virtual module resolved by abideResolverPlugin
import { assets } from './_virtual/assets.ts'
// @ts-expect-error virtual module resolved by abideResolverPlugin
import cliProgramName from './_virtual/cli-name.ts'
// @ts-expect-error virtual module resolved by abideResolverPlugin
import { layouts } from './_virtual/layouts.ts'
// @ts-expect-error virtual module resolved by abideResolverPlugin
import mcp from './_virtual/mcp.ts'
// @ts-expect-error virtual module resolved by abideResolverPlugin
import { mcpResources } from './_virtual/mcp-resources.ts'
// @ts-expect-error virtual module resolved by abideResolverPlugin
import { pages } from './_virtual/pages.ts'
// @ts-expect-error virtual module resolved by abideResolverPlugin
import { prompts } from './_virtual/prompts.ts'
// @ts-expect-error virtual module resolved by abideResolverPlugin
import { publicAssets } from './_virtual/public-assets.ts'
// @ts-expect-error virtual module resolved by abideResolverPlugin
import { rpc } from './_virtual/rpc.ts'
// @ts-expect-error virtual module resolved by abideResolverPlugin
import { shell } from './_virtual/shell.ts'
// @ts-expect-error virtual module resolved by abideResolverPlugin
import { sockets } from './_virtual/sockets.ts'
import { exitWithParent } from './lib/bundle/exitWithParent.ts'
import { loadEnvFromBinaryDir } from './lib/cli/loadEnvFromBinaryDir.ts'
import { broadcastCacheStaleness } from './lib/server/runtime/cacheStalenessBroadcaster.ts'
import { createServer } from './lib/server/runtime/createServer.ts'
import { requestContext } from './lib/server/runtime/requestContext.ts'
import { resolvePageSnapshot } from './lib/server/runtime/resolvePageSnapshot.ts'
import { cacheStalenessSlot } from './lib/shared/cacheStalenessSlot.ts'
import { cacheStoreSlot } from './lib/shared/cacheStoreSlot.ts'
import { createCacheStore } from './lib/shared/createCacheStore.ts'
import { docSnapshotsSlot } from './lib/shared/docSnapshotsSlot.ts'
import { loadEnvFromDataDir } from './lib/shared/loadEnvFromDataDir.ts'
import { pageSlot } from './lib/shared/pageSlot.ts'
import { pendingAsyncCellsSlot } from './lib/shared/pendingAsyncCellsSlot.ts'
import { resolvedCellsSlot } from './lib/shared/resolvedCellsSlot.ts'
import { runningAsStandaloneBinary } from './lib/shared/runningAsStandaloneBinary.ts'
import { sharedCacheStoreSlot } from './lib/shared/sharedCacheStoreSlot.ts'
import { socketTailsSlot } from './lib/shared/socketTailsSlot.ts'
import { streamedCellsSlot } from './lib/shared/streamedCellsSlot.ts'

/*
Resolve config into process.env before anything reads it (createServer reads
PORT, app code reads Bun.env.*). Standalone-only: data-dir first so the user's
saved config wins over the binary-dir shipped default; both back-fill only what
the shell didn't already set. A bundle launched via `open` has cwd `/`, so the
data-dir `.env` is how it gets its config at all. Under `bun dev`/`bun start`
these bundle layers don't apply — the project's own CWD `.env` (Bun-autoloaded)
is the config — so loading them would let a stray data-dir `PORT` defeat dev's
port scan.
*/
if (runningAsStandaloneBinary()) {
    await loadEnvFromDataDir(cliProgramName)
    await loadEnvFromBinaryDir()
}

/*
Eager-import src/server/config.ts (via abide:config) now that every .env layer
is merged into process.env — its top-level `env(schema)` validates the
environment and fails the boot loudly here, before the server starts, rather
than lazily on the first handler that imports `$server/config`. A dynamic
import (not a static top-level one) so it runs after the merge above, not at
module-eval time. No-op when the file is absent.
*/
// @ts-expect-error virtual module resolved by abideResolverPlugin
await import('./_virtual/config.ts')

// In a bundle, tie this server's life to the launcher's (no-op standalone).
exitWithParent()

/*
Process-level ("shared") store for cache(fn, { shared: true }) — one per server
process, outlives every request so memoised external calls are shared across them.
It is also the store a read with no request in flight resolves to, so boot/cron/
socket-handler reads coalesce into a real store instead of an orphan fallback.
*/
const sharedCacheStore = createCacheStore()
sharedCacheStoreSlot.resolver = () => sharedCacheStore

cacheStoreSlot.resolver = () => requestContext.getStore()?.cache ?? sharedCacheStore

/*
Server-side invalidate()/refresh() broadcast to every connected client instead of
mutating a throwaway request store (ADR-0041). The broadcaster is imported ONLY here
so its server socket code never enters the client reachability graph.
*/
cacheStalenessSlot.resolver = () => broadcastCacheStaleness

/* One process-wide fallback list for reads with no request in flight (boot/cron/socket) —
   real requests each carry their own `pendingAsyncCells`, so the SSR barrier drains a
   per-request list and concurrent renders never cross-contaminate. */
const sharedPendingAsyncCells = { promises: [] }
pendingAsyncCellsSlot.resolver = () =>
    requestContext.getStore()?.pendingAsyncCells ?? sharedPendingAsyncCells
const sharedResolvedCells = { entries: [] }
resolvedCellsSlot.resolver = () => requestContext.getStore()?.resolvedCells ?? sharedResolvedCells
const sharedStreamedCells = { entries: [] }
streamedCellsSlot.resolver = () => requestContext.getStore()?.streamedCells ?? sharedStreamedCells
/* No shared fallback: `defineSocket.peek` records into this on every retained-frame read, including
   reads outside any request (ws handlers, boot) — a fallback list would accumulate entries no render
   ever drains. Off-request this resolves undefined and the record is skipped (see socketTailsSlot). */
socketTailsSlot.resolver = () => requestContext.getStore()?.socketTails
const sharedDocSnapshots = { entries: [] }
docSnapshotsSlot.resolver = () => requestContext.getStore()?.docSnapshots ?? sharedDocSnapshots

pageSlot.resolver = resolvePageSnapshot

await createServer({
    pages,
    layouts,
    rpc,
    sockets,
    prompts,
    shell,
    app: appMod,
    assets,
    publicAssets,
    mcpResources,
    mcp,
    cliProgramName,
    appInfo,
    // Set by the dev orchestrator (devEntry); mounts the live-reload channel.
    dev: Bun.env.ABIDE_DEV === '1',
})
