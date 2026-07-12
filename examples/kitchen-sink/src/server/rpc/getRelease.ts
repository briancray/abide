import { GET } from '@abide/abide/server/GET'
import { json } from '@abide/abide/server/json'

/*
Stand-in for the announcement content a real app would load from a CMS or DB.
The /emails/announcement page reads it with a bare call during SSR, so the same
data flows whether the page is visited in a browser or rendered to a string by
render() for an email body.
*/
export const getRelease = GET(() =>
    json({ version: 'v2.4', headline: 'Streaming cells & faster SSR', date: 'July 2026' }),
)
