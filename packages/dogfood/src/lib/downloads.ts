// THE DOCS AS MARKDOWN, for a reader with no browser: every page at its own address with `.md` on
// the end, `abide.md` holding them all in reading order, and `llms.txt` pointing an agent at that.
// Root middleware — a module calls it rather than a route, so it is filed at the root (37.1) and
// answers addresses no route has (37.3). The root layout imports it. Each page's markdown is read
// off the page the app renders, so the words have the one home.
import { type RouteLiteral, url } from '@abide/abide'
import { middleware } from '@abide/abide/server'
import { markdownOf } from '../server/markdownOf.ts'
import { SITE } from './SITE.ts'
import { markdownAddressOf } from './sitePages.ts'

const MARKDOWN = { 'content-type': 'text/markdown; charset=utf-8' }

// Built once per process: the pages do not change while it runs.
let bundled: Promise<string> | undefined

async function pageMarkdown(route: string, origin: string): Promise<string> {
    const page = await fetch(new URL(url(route as RouteLiteral), origin))
    return markdownOf(await page.text())
}

async function bundle(origin: string): Promise<string> {
    let contents = ''
    let body = ''
    for (const group of SITE) {
        contents += `\n**${group.section}**\n\n`
        for (const page of group.pages) {
            const address = markdownAddressOf(page.route).slice(1)
            contents += `- ${page.nav} — \`${address}\`${page.stub ? ' (stub)' : ''}\n`
            body += `\n---\n\n<!-- ${address} -->\n\n${await pageMarkdown(page.route, origin)}`
        }
    }
    return `# abide documentation

The whole of the abide documentation in reading order. Every page is also served on its own
at its address with \`.md\` on the end, and the links below point at those files.

## Contents
${contents}${body}`
}

// The request a root middleware is handed is addressed below the mount, as a route is, so it is
// matched against addresses below the mount rather than against `url()`, which adds it.
middleware(async (next, { request }) => {
    const { pathname, origin } = new URL(request.url)
    if (!pathname.endsWith('.md') && !pathname.endsWith('/llms.txt'))
        return next()
    if (pathname === '/llms.txt')
        return new Response('# abide\n\nEvery page, as markdown: abide.md\n')
    if (pathname === '/abide.md') {
        bundled ??= bundle(origin)
        return new Response(await bundled, { headers: MARKDOWN })
    }
    for (const group of SITE)
        for (const page of group.pages)
            if (pathname === markdownAddressOf(page.route))
                return new Response(await pageMarkdown(page.route, origin), {
                    headers: MARKDOWN,
                })
    return next()
})
