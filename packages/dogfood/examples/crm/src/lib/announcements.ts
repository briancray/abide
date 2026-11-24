import { notices, store } from '@abide/abide'

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

/** What the CRM's banner says, each kept closed for thirty days once someone closes it. */
export const announcements = notices({
    store: store.cookies('announcements'),
    ttl: THIRTY_DAYS_MS,
    timeout: Infinity,
    initial: [
        'Pipelines can now be shared with a link.',
        'Forecasts lock at the end of each quarter.',
    ],
})
