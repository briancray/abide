// @ts-expect-error virtual module resolved by belteResolverPlugin
import { layouts } from './_virtual/layouts.ts'
// @ts-expect-error virtual module resolved by belteResolverPlugin
import { pages } from './_virtual/pages.ts'
import { startClient } from './lib/browser/startClient.ts'

await startClient({ pages, layouts })
