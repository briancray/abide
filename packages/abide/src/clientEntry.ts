// @ts-expect-error virtual module resolved by abideResolverPlugin
import { layouts } from './_virtual/layouts.ts'
// @ts-expect-error virtual module resolved by abideResolverPlugin
import { pages } from './_virtual/pages.ts'
import type { RouteLoader } from './lib/ui/runtime/types/RouteLoader.ts'
import { startClient } from './lib/ui/startClient.ts'

/*
The SSR client entry. The pages/layouts manifests are
`{ route: () => import(page.abide) }` / `{ dir: () => import(layout.abide) }`; hand
the loaders straight to abide-ui's startClient — the router imports each route's
chunk (and its layout chunks) only when first visited, so the initial load downloads
just the current route's chain (plus the entry), not every page up front. startClient
also seeds the cache from __SSR__, installs the base, and adopts the server-rendered
#app for the current route.
*/
startClient(pages as Record<string, RouteLoader>, layouts as Record<string, RouteLoader>)
