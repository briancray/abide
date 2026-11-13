import { type RouteLiteral, url } from '@abide/abide'

import { markdownOf } from './markdownOf.server.ts'

/** The page at `route` as markdown, read off the page this app renders at `origin`. */
export async function pageMarkdown(
    route: string,
    origin: string,
): Promise<string> {
    const page = await fetch(new URL(url(route as RouteLiteral), origin))
    return markdownOf(await page.text())
}
