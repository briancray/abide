// THE SITE BAR AND THE SIDEBAR SPLIT ONE `NAV`. The reference is a section of it, so a slip here
// lists the reference among the guides — or empties the sidebar on a reference page — and every
// page still renders.

import { expect, test } from 'bun:test'
import { sidebarGroupsOf, tabOf } from '../src/lib/siteSections.ts'

test('an address is in the tab its first segment names, and the guides otherwise', () => {
    expect(tabOf('/')).toBe('/')
    expect(tabOf('/values/show-a-value-that-changes')).toBe('/')
    expect(tabOf('/reference')).toBe('/reference')
    expect(tabOf('/reference/transports')).toBe('/reference')
    expect(tabOf('/bench')).toBe('/bench')
    expect(tabOf('/gate')).toBe('/gate')
    // A document is in the reference tab though no segment names it.
    expect(tabOf('/rulebook')).toBe('/reference')
    // A prefix is not a segment.
    expect(tabOf('/referencex')).toBe('/')
})

test('the sidebar lists the reference apart from the guides, and nothing beside an instrument', () => {
    const guides = sidebarGroupsOf('/data').map((group) => group.section)
    expect(guides).not.toContain('Reference')
    expect(guides).toContain('Start')
    expect(
        sidebarGroupsOf('/reference/cli').map((group) => group.section),
    ).toEqual(['Reference', 'Documents'])
    expect(sidebarGroupsOf('/rulebook').map((group) => group.section)).toEqual([
        'Reference',
        'Documents',
    ])
    expect(sidebarGroupsOf('/bench')).toEqual([])
    expect(sidebarGroupsOf('/gate')).toEqual([])
    // A page a card frames is the example's app, and lists none of the site's.
    expect(sidebarGroupsOf('/pages/add-a-page/frame/[[invoice]]')).toEqual([])
    expect(sidebarGroupsOf('/pages/give-pages-the-same-chrome/frame')).toEqual(
        [],
    )
})
