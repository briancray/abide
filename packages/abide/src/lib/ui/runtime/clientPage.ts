import type { PageSnapshot } from '../../shared/types/PageSnapshot.ts'
import { state } from '../state.ts'

/*
The client-side page snapshot the `page` proxy reads (startClient registers
`() => clientPage.value` as the page resolver). It's a abide-ui signal, so a
component reading page.url/params/route inside an effect re-runs when the router
updates it on navigation. Server renders never touch this — there the resolver
reads the per-request store instead.
*/
export const clientPage = state<PageSnapshot>({
    route: '',
    params: {},
    url: typeof location === 'undefined' ? new URL('http://localhost/') : new URL(location.href),
    navigating: false,
})
