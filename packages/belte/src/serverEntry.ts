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
import { createServer } from './lib/server/runtime/createServer.ts'
import { requestContext } from './lib/server/runtime/requestContext.ts'
import { setCacheStoreResolver } from './lib/shared/setCacheStoreResolver.ts'

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
