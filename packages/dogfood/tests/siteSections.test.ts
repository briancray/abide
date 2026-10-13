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
    // A prefix is not a segment.
    expect(tabOf('/referencex')).toBe('/')
})

test('the sidebar lists the reference apart from the guides, and nothing beside an instrument', () => {
    const guides = sidebarGroupsOf('/data').map((group) => group.section)
    expect(guides).not.toContain('Reference')
    expect(guides).toContain('Start')
    expect(
        sidebarGroupsOf('/reference/cli').map((group) => group.section),
    ).toEqual(['Reference'])
    expect(sidebarGroupsOf('/bench')).toEqual([])
    expect(sidebarGroupsOf('/gate')).toEqual([])
})
