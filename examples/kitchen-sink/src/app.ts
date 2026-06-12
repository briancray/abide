/*
Kitchen-sink app hooks. Belte resolves this file at build time via the
belte:app virtual module — no import is needed from your own code. All five
hooks are exported here to show each one in action:

  forwardHeaders extra inbound header names forwarded onto in-process rpc
                 Requests (SSR / MCP), on top of belte's cookie/authorization/
                 traceparent/tracestate/x-forwarded-* allowlist
  init           runs once after Bun.serve is up — your one-time setup goes here
  handle         middleware that wraps the request pipeline — used here to stamp
                 every outgoing Response with an x-server header
  handleError    fallback 500 page — replaces belte's default stack-trace HTML
  health         app fields merged into the /__belte/health payload the client
                 health() polls — see /health
*/
import type { AppModule } from '@belte/belte/server/AppModule'
import { sessionFromRequest } from './sessions.ts'

/*
whoAmI (see /rpc/request-scope) reads `user-agent` off the inbound request.
In-process calls forward only cookie/authorization/traceparent/tracestate/
x-forwarded-* by default, so without this line the SSR read would see nothing.
*/
export const forwardHeaders = ['user-agent']

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

/*
Fields merged into the /__belte/health payload the client health() polls.
Runs ahead of `handle` (reporting "authenticated: false" requires answering
without auth) and outside any request scope, so the session is read off the
raw Request. The payload is public — never put secrets in it.
*/
export const health: AppModule['health'] = (request) => ({
    authenticated: sessionFromRequest(request) !== undefined,
})
