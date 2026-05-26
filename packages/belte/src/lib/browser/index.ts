/*
Public umbrella for an HTML client: the reactive `page` state object, the
SPA `navigate` action, and the data primitives consumed inside `.svelte`
components (`cache` for request/response caches, `subscribe` for
streaming responses or socket fan-outs).

User code:
  import { page, navigate, cache, subscribe } from 'belte/browser'

This is the first of what will become several "consumer-type" surfaces
(cli, mcp, …); each future consumer gets its own sibling umbrella with
the data primitives shaped for that consumer.
*/
export { navigate, page } from './page.svelte.ts'
export { cache } from './cache.ts'
export { subscribe } from './subscribe.ts'
/*
HttpError is thrown server-side but caught browser-side, so it sits in
both umbrellas. Importing it from `belte/server` in a page would pull
the server runtime (AsyncLocalStorage etc.) into the client bundle —
import from here instead.
*/
export { HttpError } from '../server/respond/HttpError.ts'
