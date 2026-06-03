import { createCacheStore } from '../../shared/createCacheStore.ts'
import { log } from '../../shared/log.ts'
import type { AppModule } from '../AppModule.ts'
import { internalErrorResponse } from './internalErrorResponse.ts'
import { requestContext } from './requestContext.ts'
import type { RequestStore } from './types/RequestStore.ts'

/*
Establishes the per-request scope and runs `body` inside it: a fresh
CacheStore plus request metadata published through the AsyncLocalStorage
RequestStore (so cache() and request()/server() resolve without threading
args), the app's handleError — or the framework's 500 fallback — on a thrown
body, and optional request logging. The single seam every dynamic route
crosses; extracted from createServer so the scope, error, and logging
behaviour is exercisable through this interface without booting a Bun server.
*/
export function runWithRequestScope(
    req: Request,
    options: { app?: AppModule; logRequests: boolean },
    body: (store: RequestStore) => Promise<Response>,
): Promise<Response> {
    const url = new URL(req.url)
    const store: RequestStore = {
        url,
        req,
        cache: createCacheStore(),
    }
    return requestContext.run(store, async () => {
        const start = options.logRequests ? Bun.nanoseconds() : 0
        let response: Response
        try {
            response = await body(store)
        } catch (error) {
            if (options.app?.handleError) {
                response = await options.app.handleError(error, req)
            } else {
                log.error(error)
                response = internalErrorResponse(error)
            }
        }
        if (options.logRequests) {
            const ms = (Bun.nanoseconds() - start) / 1e6
            log.request(req.method, `${url.pathname}${url.search}`, response.status, ms)
        }
        return response
    })
}
