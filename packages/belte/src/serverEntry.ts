// @ts-expect-error virtual module resolved by belteResolverPlugin
import * as appMod from './_virtual/app.ts'
// @ts-expect-error virtual module resolved by belteResolverPlugin
import { appInfo } from './_virtual/app-info.ts'
// @ts-expect-error virtual module resolved by belteResolverPlugin
import { assets } from './_virtual/assets.ts'
// @ts-expect-error virtual module resolved by belteResolverPlugin
import cliProgramName from './_virtual/cli-name.ts'
// @ts-expect-error virtual module resolved by belteResolverPlugin
import { layouts } from './_virtual/layouts.ts'
// @ts-expect-error virtual module resolved by belteResolverPlugin
import mcp from './_virtual/mcp.ts'
// @ts-expect-error virtual module resolved by belteResolverPlugin
import { mcpResources } from './_virtual/mcp-resources.ts'
// @ts-expect-error virtual module resolved by belteResolverPlugin
import { pages } from './_virtual/pages.ts'
// @ts-expect-error virtual module resolved by belteResolverPlugin
import { prompts } from './_virtual/prompts.ts'
// @ts-expect-error virtual module resolved by belteResolverPlugin
import { publicAssets } from './_virtual/public-assets.ts'
// @ts-expect-error virtual module resolved by belteResolverPlugin
import { rpc } from './_virtual/rpc.ts'
// @ts-expect-error virtual module resolved by belteResolverPlugin
import { shell } from './_virtual/shell.ts'
// @ts-expect-error virtual module resolved by belteResolverPlugin
import { sockets } from './_virtual/sockets.ts'
import { exitWithParent } from './lib/bundle/exitWithParent.ts'
import { loadEnvFromBinaryDir } from './lib/cli/loadEnvFromBinaryDir.ts'
import { createServer } from './lib/server/runtime/createServer.ts'
import { requestContext } from './lib/server/runtime/requestContext.ts'
import { loadEnvFromDataDir } from './lib/shared/loadEnvFromDataDir.ts'
import { runningAsStandaloneBinary } from './lib/shared/runningAsStandaloneBinary.ts'
import { setCacheStoreResolver } from './lib/shared/setCacheStoreResolver.ts'

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

// In a bundle, tie this server's life to the launcher's (no-op standalone).
exitWithParent()

setCacheStoreResolver(() => requestContext.getStore()?.cache)

await createServer({
    pages,
    rpc,
    sockets,
    prompts,
    layouts,
    shell,
    app: appMod,
    assets,
    publicAssets,
    mcpResources,
    mcp,
    cliProgramName,
    appInfo,
})
