/*
Kitchen-sink app hooks. Abide resolves this file at build time via the
abide:app virtual module — no import is needed from your own code. All five
hooks are exported here to show each one in action:

  forwardHeaders extra inbound header names forwarded onto in-process rpc
                 Requests (SSR / MCP), on top of abide's cookie/authorization/
                 traceparent/tracestate/x-forwarded-* allowlist
  init           runs once after Bun.serve is up — your one-time setup goes here
  handle         middleware that wraps the request pipeline — used here to stamp
                 every outgoing Response with an x-server header
  handleError    fallback 500 page — replaces abide's default stack-trace HTML
  health         app fields merged into the /__abide/health payload the client
                 health() polls — see /health
*/
import type { AppModule } from '@abide/abide/server/AppModule'

/*
whoAmI (see /rpc/request-scope) reads `user-agent` off the inbound request.
In-process calls forward only cookie/authorization/traceparent/tracestate/
x-forwarded-* by default, so without this line the SSR read would see nothing.
*/
export const forwardHeaders = ['user-agent']

/* Boot timestamp recorded in `init`, reported as uptime by the `health` hook. */
let bootedAt = 0

export const init: AppModule['init'] = () => {
    // one-time setup goes here; record boot time so the health hook can report uptime
    bootedAt = Date.now()
}

export const handle: AppModule['handle'] = async (request, next) => {
    const response = await next(request)
    response.headers.set('x-server', 'abide')
    return response
}

export const handleError: AppModule['handleError'] = (error) => {
    console.error(error)
    return new Response('something went wrong — check the server logs', { status: 500 })
}

/*
Fields merged into the /__abide/health payload the client health() polls.
Runs outside any request scope — it takes the raw Request but needs nothing
off it here. The payload is public — never put secrets in it.
*/
export const health: AppModule['health'] = () => ({
    uptimeSeconds: Math.floor((Date.now() - bootedAt) / 1000),
})
