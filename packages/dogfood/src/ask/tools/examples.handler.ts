import { GET } from '@abide/abide/server'

import { siteExamples } from '../lib/siteExamples.server.ts'

export default GET(() => siteExamples(), {
    description:
        'Every live example card on the abide docs site: its id (for <show example="id"/>), the page it is on, its title, its summary and the CRM files it is made of.',
})
