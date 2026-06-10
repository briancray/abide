import type { PageSnapshot } from '../../shared/types/PageSnapshot.ts'
import { pageUrlFromStore } from './pageUrlFromStore.ts'
import { requestContext } from './requestContext.ts'

/*
The server's page resolver: the `page` proxy reads route/params/url off the
ALS request store, so layout-scoped components see the live match during SSR
without a module singleton leaking across concurrent or streaming renders.
route/params land just before render; url is set at the request boundary, so
404/error renders still get a correct page.url. Registered by serverEntry at
boot and mirrored by bootTestServer; undefined outside a request scope falls
through to activePage's empty fallback.
*/
export function resolvePageSnapshot(): PageSnapshot | undefined {
    const store = requestContext.getStore()
    if (!store) {
        return undefined
    }
    return {
        route: store.route ?? '',
        params: store.params ?? {},
        url: pageUrlFromStore(store),
        navigating: false,
    }
}
