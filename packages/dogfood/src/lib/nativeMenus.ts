import { type MenuItem, menuItem } from '@abide/abide'

import { SITE } from './SITE.ts'

const plain = (text: string) => text.replaceAll('`', '')

/** The Ask menu's one item: ⌘K, which lands in the prompt (`Ask.abide`). */
export const ASK_ITEM = menuItem({ label: 'Ask Claude…', key: 'cmd+k' })

// Every primitive's page, a submenu per group, as the sidebar lists them.
const REFERENCE: MenuItem[] = []
for (const group of SITE) {
    const items: MenuItem[] = []
    for (const page of group.pages)
        items.push({ label: plain(page.nav), href: page.route })
    REFERENCE.push({ label: plain(group.group), items })
}

/** The menus the docs add to the native app's menu bar (38.88). */
export const MENUS: readonly MenuItem[] = [
    { label: 'Ask', items: [ASK_ITEM] },
    {
        label: 'Reference',
        items: [
            { label: 'Overview', key: 'cmd+shift+o', href: '/' },
            'separator',
            ...REFERENCE,
        ],
    },
    {
        label: 'Help',
        items: [
            { label: 'Rulebook', href: '/rulebook' },
            { label: 'The native app', href: '/configuration/native' },
        ],
    },
]
