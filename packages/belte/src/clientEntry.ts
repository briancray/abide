// @ts-expect-error virtual module resolved by belteResolverPlugin
import { layouts } from './_virtual/layouts.ts'
// @ts-expect-error virtual module resolved by belteResolverPlugin
import { routes } from './_virtual/routes.ts'
import { startClient } from './lib/client/startClient.ts'

await startClient({ routes, layouts })
