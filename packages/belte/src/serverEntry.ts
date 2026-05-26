// @ts-expect-error virtual module resolved by belteResolverPlugin
import * as appMod from './_virtual/app.ts'
// @ts-expect-error virtual module resolved by belteResolverPlugin
import { assets } from './_virtual/assets.ts'
// @ts-expect-error virtual module resolved by belteResolverPlugin
import { layouts } from './_virtual/layouts.ts'
// @ts-expect-error virtual module resolved by belteResolverPlugin
import { pages } from './_virtual/pages.ts'
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
    layouts,
    shell,
    app: appMod,
    assets,
})
