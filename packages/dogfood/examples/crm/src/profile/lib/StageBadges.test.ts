import { expect, test } from 'bun:test'

import { mount } from '@abide/harness/abide'

import StageBadges from './StageBadges.abide'

// The scope token: an attribute every rule in a `<style>` requires.
const tokensOf = (element: Element) =>
    element.getAttributeNames().filter((name) => name !== 'class')

test('each badge carries its own scope token, not the other', async () => {
    using _badges = await mount(StageBadges({}))
    const [lead, customer] = document.querySelectorAll('.badge')
    if (!lead || !customer) throw new Error('two badges render')
    const [leadToken] = tokensOf(lead)
    const [customerToken] = tokensOf(customer)
    expect(leadToken).toBeDefined()
    expect(customerToken).toBeDefined()
    expect(leadToken).not.toBe(customerToken)
    expect(customer.hasAttribute(leadToken as string)).toBe(false)
})
