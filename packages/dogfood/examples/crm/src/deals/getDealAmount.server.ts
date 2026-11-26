import { request, rpc } from '@abide/abide/server'

import { DEALS } from './lib/DEALS.server.ts'

/** A deal's amount, written the way the caller's language writes numbers. */
export default rpc(
    ({ id }: { id: string }) => {
        const deal = DEALS.find((each) => each.id === id)
        const locale = request().headers.get('accept-language')?.split(',')[0]
        return new Intl.NumberFormat(locale).format(deal?.amount ?? 0)
    },
    { description: "A deal's amount, in the caller's number format." },
)
