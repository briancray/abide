import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { measure, mount } from '@abide/harness/abide'
import { atMost } from '@abide/harness/gate'

import RepTrends from './RepTrends.abide'

const lines = () =>
    [...document.querySelectorAll('svg')].filter(
        (svg) => svg.querySelector('[data-part=line]') !== null,
    )
const trends = () => lines().map((line) => line.getAttribute('data-trend'))

test("a rep's sparkline carries its trend, and redraws in place", async () => {
    using _trends = await mount(RepTrends({}))
    expect(trends()).toEqual(['up', 'down', 'flat'])
    const grace = lines()[1]
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

// THE REVERT: scale the bars from their lowest value to their highest, and Alan's six deals a month
// draw as nothing, and Ada's two as no bar at all.
test("a rep's deals closed draw as bars up from zero, as long as the count", async () => {
    using _trends = await mount(RepTrends({}))
    const bars = [...document.querySelectorAll('[data-part=bar]')]
    expect(bars).toHaveLength(3)
    // Each bar is `M left,zero H right V top H left Z`: its height is zero less its top.
    const heights = (bar: Element | undefined) =>
        [
            ...(bar?.getAttribute('d') ?? '').matchAll(
                /M[\d.]+,([\d.]+)H[\d.]+V([\d.]+)/g,
            ),
        ].map((match) => Math.round(Number(match[1]) - Number(match[2])))
    // Ada closed 2, 3, 3, 4, 5, 6: the 2 is a third of the 6.
    expect(heights(bars[0])).toEqual([33, 50, 50, 67, 83, 100])
    // Alan closed 1 a month, every bar full.
    expect(heights(bars[2])).toEqual([100, 100, 100, 100, 100, 100])
    // Grace's August is missing: five bars.
    expect(heights(bars[1])).toHaveLength(5)
})
