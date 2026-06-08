/*
Kitchen-sink app hooks. Belte resolves this file at build time via the
belte:app virtual module — no import is needed from your own code. Three
hooks are exported here to show each one in action:

  init        runs once after Bun.serve is up — your one-time setup goes here
  handle      middleware that wraps the request pipeline — used here to stamp
              every outgoing Response with an x-server header
  handleError fallback 500 page — replaces belte's default stack-trace HTML
*/
import type { AppModule } from '@belte/belte/server/AppModule'

export const init: AppModule['init'] = () => {
    // one-time setup goes here; belte already logs the boot URL, so nothing to print
}

export const handle: AppModule['handle'] = async (request, next) => {
    const response = await next(request)
    response.headers.set('x-server', 'belte')
    return response
}

export const handleError: AppModule['handleError'] = (error) => {
    console.error(error)
    return new Response('something went wrong — check the server logs', { status: 500 })
}
