// @ts-expect-error virtual module resolved by belteResolverPlugin
import { apis } from './_virtual/apis.ts'
// @ts-expect-error virtual module resolved by belteResolverPlugin
import { assets } from './_virtual/assets.ts'
// @ts-expect-error virtual module resolved by belteResolverPlugin
import { layouts } from './_virtual/layouts.ts'
// @ts-expect-error virtual module resolved by belteResolverPlugin
import { routes } from './_virtual/routes.ts'
// @ts-expect-error virtual module resolved by belteResolverPlugin
import { shell } from './_virtual/shell.ts'
// @ts-expect-error virtual module resolved by belteResolverPlugin
import * as socketMod from './_virtual/socket.ts'
import { createServer } from './createServer.ts'

await createServer({
    routes,
    apis,
    layouts,
    shell,
    socket: socketMod.socket,
    socketUpgrade: socketMod.upgrade,
    socketPath: socketMod.path,
    assets,
})
