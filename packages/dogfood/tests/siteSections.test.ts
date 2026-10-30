// THE SITE BAR AND THE SIDEBAR SPLIT ONE `NAV`. The reference is a section of it, so a slip here
// lists the reference among the guides — or empties the sidebar on a reference page — and every
// page still renders.

import { expect, test } from 'bun:test'

import { sidebarGroupsOf, tabOf } from '../src/lib/siteSections.ts'

test('an address is in the tab its first segment names, and the guides otherwise', () => {
    expect(tabOf('/')).toBe('/')
    expect(tabOf('/guide/run-it')).toBe('/')
    expect(tabOf('/reference')).toBe('/reference')
    expect(tabOf('/reference/watch')).toBe('/reference')
    // A document is in the reference tab though no segment names it.
    expect(tabOf('/rulebook')).toBe('/reference')
    // A prefix is not a segment.
    expect(tabOf('/referencex')).toBe('/')
})

test("the sidebar lists the reference apart from the guide, and nothing beside an app's page", () => {
    const guides = sidebarGroupsOf('/guide/run-it').map(
        (group) => group.section,
    )
    expect(guides).not.toContain('Reference')
    expect(guides).toContain('Build a CRM')
    // The reference's overview, then its pages under each REGISTRY group, then the documents.
    const reference = sidebarGroupsOf('/reference/cli').map(
        (group) => group.section,
    )
    expect(reference[0]).toBe('Reference')
    expect(reference).toContain('Reactive primitives')
    expect(reference).toContain('CLI')
    expect(reference.at(-1)).toBe('Documents')
    expect(sidebarGroupsOf('/rulebook')).toEqual(
        sidebarGroupsOf('/reference/cli'),
    )
    // A chapter app's page is that app, and lists none of the site's.
    expect(sidebarGroupsOf('/companies/[id]')).toEqual([])
    expect(sidebarGroupsOf('/')).not.toEqual([])
})
