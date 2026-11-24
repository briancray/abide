import { isFailed, type RouteLiteral, url } from '@abide/abide'
import { fetchData, type FetchFailed } from '@abide/abide/server'

import { markdownOf } from './markdownOf.server.ts'
import { ownOrigin } from './ownOrigin.server.ts'

/** The page at `route` as markdown, read off the page this app renders, or why it could not be read. */
export async function pageMarkdown(
    route: string,
): Promise<string | FetchFailed> {
    const page = await fetchData(
        new URL(url(route as RouteLiteral), ownOrigin()),
        {
            as: 'text',
        },
    )
    return isFailed(page) ? page : markdownOf(page)
}
