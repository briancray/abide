import { GET, refuse, request } from '@abide/abide/server'

import { pageMarkdown } from '#src/lib/pageMarkdown.server.ts'
import { isSitePage } from '#src/lib/sitePages.ts'

export default GET(
    async ({ route }: { route: string }) => {
        if (!isSitePage(route)) throw refuse.notFound({ path: route, method: 'GET' })
        return pageMarkdown(route, new URL(request().url).origin)
    },
    {
        description:
            "One abide docs page as markdown: its prose, its example cards' files, and its REGISTRY rows. `route` is a page's route, e.g. /reactive/watch.",
    },
)
