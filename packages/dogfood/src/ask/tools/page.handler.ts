import { GET, refuse } from '@abide/abide/server'

import { ownOrigin } from '#src/lib/ownOrigin.server.ts'
import { pageMarkdown } from '#src/lib/pageMarkdown.server.ts'
import { sitePageAt } from '#src/lib/sitePages.ts'

export default GET(
    async ({ route }: { route: string }) => {
        if (sitePageAt(route) === undefined)
            throw refuse.notFound({ path: route, method: 'GET' })
        return pageMarkdown(route, ownOrigin())
    },
    {
        description:
            "One abide docs page as markdown: its syntax rows, its examples, its see-also links, its test cases and its rules. `route` is a page's route, e.g. /reactive/watch.",
    },
)
