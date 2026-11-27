// THE NATIVE APP'S MENU BAR, against the sidebar the served page shows: the same pages under the
// same groups, so a reader in the native app finds a page where a reader in the browser does.

import { expect, test } from 'bun:test'

import type { MenuItem } from '@abide/abide'

import { MENUS } from '../src/lib/nativeMenus.ts'
import { PAGES } from '../src/lib/sitePages.ts'
import { DOGFOOD, servedDocs } from './docsPages.ts'

function textOf(markup: string): string {
    return markup
        .replace(/<[^>]*>/g, '')
        .replaceAll('&amp;', '&')
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .trim()
}

/** Every `href` under `items`, at any depth. */
function hrefsOf(items: readonly MenuItem[], into: string[] = []): string[] {
    for (const item of items) {
        if (typeof item === 'string') continue
        if (item.href !== undefined) into.push(item.href)
        if ('items' in item && item.items !== undefined)
            hrefsOf(item.items, into)
    }
    return into
}

// 40.30 — EVERY PAGE IN THE MENU BAR, GROUPED AS THE SIDEBAR GROUPS THEM: a submenu of Reference per
// sidebar section, holding the pages that section links, and the menus filed by the root layout
// through `onMenu`, the one way a page reaches the native window's menu bar (38.88).
// THE REVERT: build `REFERENCE` in `nativeMenus.ts` from `group.pages.slice(1)`; 18 groups read their first page missing where the sidebar lists it.
test('the native menu bar files every page, grouped as the sidebar groups them — 40.30', async () => {
    const layout = await Bun.file(`${DOGFOOD}src/layout.abide`).text()
    expect(layout).toContain('onMenu(() => MENUS)')

    const { base } = await servedDocs()
    const document = await (await Bun.fetch(`${base}/`)).text()
    const nav = document.slice(
        document.indexOf('<nav class="sidebar'),
        document.indexOf('</nav>'),
    )
    // The sidebar's Documents section links the rulebook, which is no page of `SITE`: the menu bar
    // files it under Help, so it is asked for there, below, rather than as a group.
    const routes = new Set<string>()
    for (const page of PAGES) routes.add(page.route)
    const sidebar: [string, string[]][] = []
    for (const section of nav.split('<section').slice(1)) {
        const heading = /<h2[^>]*>([\s\S]*?)<\/h2>/.exec(section)?.[1] ?? ''
        const links = new Set<string>()
        for (const [, href] of section.matchAll(/href="([^"]*)"/g))
            links.add(href as string)
        if (!links.values().some((link) => routes.has(link))) continue
        sidebar.push([textOf(heading), [...links].sort()])
    }

    const reference = MENUS.find(
        (menu) => typeof menu !== 'string' && menu.label === 'Reference',
    ) as { items: MenuItem[] }
    const menuBar: [string, string[]][] = []
    for (const item of reference.items)
        if (typeof item !== 'string' && 'items' in item && item.items)
            menuBar.push([item.label, hrefsOf(item.items).sort()])
    expect(sidebar.length).toBeGreaterThan(0)
    expect(menuBar).toEqual(sidebar)

    const filed = new Set(hrefsOf(MENUS))
    const unfiled: string[] = []
    for (const route of [...routes, '/rulebook'])
        if (!filed.has(route)) unfiled.push(route)
    expect(unfiled).toEqual([])
})
