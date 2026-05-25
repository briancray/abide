// @ts-expect-error virtual module resolved by belteResolverPlugin
import * as appMod from './_virtual/app.ts'
// @ts-expect-error virtual module resolved by belteResolverPlugin
import { assets } from './_virtual/assets.ts'
// @ts-expect-error virtual module resolved by belteResolverPlugin
import { layouts } from './_virtual/layouts.ts'
// @ts-expect-error virtual module resolved by belteResolverPlugin
import { pages } from './_virtual/pages.ts'
// @ts-expect-error virtual module resolved by belteResolverPlugin
import { route } from './_virtual/route.ts'
// @ts-expect-error virtual module resolved by belteResolverPlugin
import { shell } from './_virtual/shell.ts'
// @ts-expect-error virtual module resolved by belteResolverPlugin
import { sockets } from './_virtual/sockets.ts'
import { createServer } from './lib/server/createServer.ts'
import { requestContext } from './lib/server/requestContext.ts'
import { setCacheStoreResolver } from './lib/shared/activeCacheStore.ts'

setCacheStoreResolver(() => requestContext.getStore()?.cache)

await createServer({
    pages,
    route,
    sockets,
    layouts,
    shell,
    app: appMod,
    assets,
})
