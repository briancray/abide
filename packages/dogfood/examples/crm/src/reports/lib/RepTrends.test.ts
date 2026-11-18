import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { measure, mount } from '@abide/harness/abide'
import { atMost } from '@abide/harness/gate'

import RepTrends from './RepTrends.abide'

const trends = () =>
    [...document.querySelectorAll('svg')].map((line) =>
        line.getAttribute('data-trend'),
    )

test("a rep's sparkline carries its trend, and redraws in place", async () => {
    using _trends = await mount(RepTrends({}))
    expect(trends()).toEqual(['up', 'down', 'flat'])
    const grace = document.querySelectorAll('svg')[1]
    expect(grace?.getAttribute('role')).toBe('img')
    expect(grace?.getAttribute('aria-label')).toBe(
        "Grace Hopper's won revenue, 6 months",
    )
    // August is missing, so Grace's line is two runs.
    const line = grace?.querySelector('[data-part=line]')
    expect(line?.getAttribute('d')?.match(/M/g)).toHaveLength(2)
    expect(grace?.querySelector('[data-part=dot]')).not.toBeNull()
    const work = measure(() => {
        ;(document.querySelectorAll('.tabs button')[1] as HTMLElement).click()
        flushSync()
    })
    expect(trends()).toEqual(['up', 'up', 'flat'])
    atMost(work, { nodesCreated: 0 })
})
