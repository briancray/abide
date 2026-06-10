import { withBaseUrl } from '../../shared/withBaseUrl.ts'
import type { RequestStore } from './types/RequestStore.ts'

/*
The browser-space URL `page.url` publishes for a request: store.url with the
mount base re-applied, matching what window.location shows under a proxy
mount, so an active-state compare against url() output hydrates identically.
store.url itself stays app-space (base-stripped by the proxy) for routing and
error-prefix matching. Memoized on the store so repeated page-proxy reads
share one URL.
*/
export function pageUrlFromStore(store: RequestStore): URL {
    store.pageUrl ??= withBaseUrl(store.url)
    return store.pageUrl
}
