// @ts-expect-error virtual module resolved by belteResolverPlugin
import { layouts } from './_virtual/layouts.ts'
// @ts-expect-error virtual module resolved by belteResolverPlugin
import { pages } from './_virtual/pages.ts'
// @ts-expect-error virtual module resolved by belteResolverPlugin
import { prompts } from './_virtual/prompts.ts'
// @ts-expect-error virtual module resolved by belteResolverPlugin
import { rpc } from './_virtual/rpc.ts'
// @ts-expect-error virtual module resolved by belteResolverPlugin
import { sockets } from './_virtual/sockets.ts'
import { build } from './build.ts'

/*
Dev-only entry. Each `bun --watch` restart re-runs the client build (so the
browser-served bundle matches the freshly-evaluated server modules) and then
eagerly invokes every dynamic loader for pages, layouts, rpc handlers, and
sockets. That pulls those files into Bun's import graph from boot, so the
watcher sees edits to a page or component on the *first* save instead of
needing the page to be visited once to warm the dynamic import. Finally
hands off to the normal server entry, which expects the same virtual
modules — they're already cached, so it just runs createServer().
*/
await build({ cwd: process.cwd(), minify: false })

await Promise.all([
    ...Object.values(pages).map((loader) => (loader as () => Promise<unknown>)()),
    ...Object.values(layouts).map((loader) => (loader as () => Promise<unknown>)()),
    ...Object.values(rpc).map((loader) => (loader as () => Promise<unknown>)()),
    ...Object.values(sockets).map((loader) => (loader as () => Promise<unknown>)()),
    ...Object.values(prompts).map((loader) => (loader as () => Promise<unknown>)()),
])

await import('./serverEntry.ts')
