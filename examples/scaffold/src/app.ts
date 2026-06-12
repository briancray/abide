/*
Optional application hooks. Every export is optional; delete the ones you
don't need. Belte resolves this file at build time via the belte:app virtual
module — no import is needed from your own code.

  forwardHeaders extra inbound header names forwarded onto in-process rpc
                 Requests (SSR / MCP), on top of belte's cookie/authorization/
                 traceparent/tracestate/x-forwarded-* allowlist
  init           runs once after Bun.serve is up; return a cleanup for SIGINT/SIGTERM
  handle         middleware wrapping the default request pipeline
  handleError    custom 500 fallback
  health         app fields merged into the /__belte/health payload the
                 client health() polls — public, never put secrets in it
*/
import type { AppModule } from '@belte/belte/server/AppModule'

export const init: AppModule['init'] = () => {
    // one-time setup; optionally return a cleanup to run on SIGINT/SIGTERM
}

export const handle: AppModule['handle'] = async (request, next) => {
    return next(request)
}

export const handleError: AppModule['handleError'] = (error) => {
    console.error(error)
    return new Response('something went wrong', { status: 500 })
}
