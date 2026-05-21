import type { RequestStore } from '../types/RequestStore.ts'
import { requestContext } from './requestContext.ts'

/*
Returns the active request store or throws — used by response-mutation
helpers (setHeader/setCookie/setStatus) so they fail loudly when called
outside a request rather than silently dropping the write.
*/
export function requireStore(caller: string): RequestStore {
    const store = requestContext.getStore()
    if (!store) {
        throw new Error(`[belte] ${caller} must be called within a request`)
    }
    return store
}
