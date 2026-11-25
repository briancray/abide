// THE DOCS AS MARKDOWN, for a reader with no browser: every page at its own address with `.md` on
// the end, `abide.md` holding them all in reading order, and `llms.txt` pointing an agent at that.
// And the CRM as a tarball, at `/examples/crm.tar.gz`.
// A rung the root layout files as middleware, so it answers addresses no route has (37.3). Each
// page's markdown is read off the page the app renders, so the words have the one home.
import { isFailed, type Middleware } from '@abide/abide'
import type { FetchFailed } from '@abide/abide/server'

import { exampleArchive } from './exampleArchive.server.ts'
import { pageMarkdown } from './pageMarkdown.server.ts'
import { SITE } from './SITE.ts'
import { markdownAddressOf, PAGES } from './sitePages.ts'

const MARKDOWN = { 'content-type': 'text/markdown; charset=utf-8' }

/** Markdown as the answer, or the refusal a page that could not be read settled to. */
function markdownAnswer(
    markdown: string | FetchFailed,
): Response | FetchFailed {
    return isFailed(markdown)
        ? markdown
        : new Response(markdown, { headers: MARKDOWN })
}

// Built once per process: the pages do not change while it runs.
let bundled: Promise<string | FetchFailed> | undefined

async function bundle(): Promise<string | FetchFailed> {
    let contents = ''
    for (const group of SITE) {
        contents += `\n**${group.group}**\n\n`
        for (const page of group.pages)
            contents += `- ${page.nav} — \`${markdownAddressOf(page.route).slice(1)}\`: ${page.description}\n`
    }
    let body = ''
    for (const page of PAGES) {
        const markdown = await pageMarkdown(page.route)
        if (isFailed(markdown)) return markdown
        body += `\n---\n\n<!-- ${markdownAddressOf(page.route).slice(1)} -->\n\n${markdown}`
    }
    return `# abide documentation

Every abide primitive, a page each, grouped by what it is for. Every page is also served on its own
at its address with \`.md\` on the end, and the links below point at those files.

## Contents
${contents}${body}`
}

// The request a root middleware is handed is addressed below the mount, as a route is, so it is
// matched against addresses below the mount rather than against `url()`, which adds it.
export const serveDownloads: Middleware<Response> = async (
    next,
    { request },
) => {
    const { pathname } = new URL(request.url)
    if (pathname === '/examples/crm.tar.gz') {
        const archive = await exampleArchive()
        return archive
            ? new Response(archive, {
                  headers: {
                      'content-type': 'application/gzip',
                      'content-disposition':
                          'attachment; filename="crm.tar.gz"',
                  },
              })
            : next()
    }
    if (!pathname.endsWith('.md') && !pathname.endsWith('/llms.txt'))
        return next()
    if (pathname === '/llms.txt')
        return new Response('# abide\n\nEvery page, as markdown: abide.md\n')
    if (pathname === '/abide.md') {
        bundled ??= bundle()
        const contents = await bundled
        // A page that could not be read is not kept: the next ask builds the bundle again.
        if (isFailed(contents)) bundled = undefined
        return markdownAnswer(contents)
    }
    for (const page of PAGES)
        if (pathname === markdownAddressOf(page.route))
            return markdownAnswer(await pageMarkdown(page.route))
    return next()
}
