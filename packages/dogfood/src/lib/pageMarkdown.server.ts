import { isFailed, type RouteLiteral, url } from '@abide/abide'
import { fetchData, type FetchFailed } from '@abide/abide/server'

import { markdownOf } from './markdownOf.server.ts'

/**
 * The page at `route` as markdown, read off the page this app renders at `origin`, or why the page
 * could not be read.
 */
export async function pageMarkdown(
    route: string,
    origin: string,
): Promise<string | FetchFailed> {
    const page = await fetchData(new URL(url(route as RouteLiteral), origin), {
        as: 'text',
    })
    return isFailed(page) ? page : markdownOf(page)
}
