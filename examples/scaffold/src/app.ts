/*
Optional application hooks. Every export is optional; delete the ones you
don't need. Belte resolves this file at build time via the belte:app virtual
module — no import is needed from your own code.

  init        runs once after Bun.serve is up; return a cleanup for SIGINT/SIGTERM
  handle      middleware wrapping the default request pipeline
  handleError custom 500 fallback
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
