import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import ClosedByWeek from './ClosedByWeek.abide'

const chart = () => document.querySelector('[data-chart=svg]') as HTMLDivElement
const texts = (selector: string) =>
    [...document.querySelectorAll(selector)].map((node) => node.textContent)
// A column's place and size, read off the percentages its part carries (52.113).
function columns() {
    return [...chart().querySelectorAll('[data-chart=bar]')].map((bar) => {
        const style = (bar as HTMLElement).style
        const read = (name: string) =>
            Number.parseFloat(style.getPropertyValue(name))
        return {
            x: read('--x'),
            y: read('--y'),
            width: read('--width'),
            height: read('--height'),
        }
    })
}
function press(key: string) {
    chart().dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    )
    flushSync()
}

// 52.81, 52.113 — A CHART DRAWN IN HTML: nothing in the parts asks for SVG, so a `div` is the chart and
// each column a `span` placed by percentages of it, as tall as its week's count and standing on one
// floor. THE REVERT: write the bars' vars in px of the box — `--height: 60` where a share is due, and
// the tallest column runs past the chart.
test('the columns are spans placed as shares of the chart, each as tall as its count', async () => {
    using _chart = await mount(ClosedByWeek({}))
    expect(chart().tagName).toBe('DIV')
    expect(chart().getAttribute('role')).toBe('img')
    const drawn = columns()
    expect(drawn).toHaveLength(6)
    const floor = (drawn[0]?.y ?? 0) + (drawn[0]?.height ?? 0)
    for (const column of drawn) {
        expect(column.y + column.height).toBeCloseTo(floor, 1)
        expect(column.x + column.width).toBeLessThanOrEqual(100)
    }
    // 7 deals against 2, as tall as each other as their counts are.
    expect((drawn[5]?.height ?? 0) / (drawn[2]?.height ?? 1)).toBeCloseTo(
        3.5,
        1,
    )
    expect(floor).toBeLessThanOrEqual(100)
})

// 52.69, 52.71 — ONE TAB STOP, AND THE KEYS READ IT: the `div` takes focus where the spans do not, the
// arrows step the crosshair a week at a time, and each step is read out.
// THE REVERT: drop `onkeydown` from the chart's root part — no arrow moves the crosshair, and
// nothing is read out.
test('the chart is one tab stop whose arrows step the weeks and read each out', async () => {
    using _chart = await mount(ClosedByWeek({}))
    expect(chart().getAttribute('tabindex')).toBe('0')
    expect(document.querySelectorAll('[tabindex]')).toHaveLength(1)
    press('ArrowRight')
    press('ArrowRight')
    expect(texts('[data-chart=readout-value]')).toEqual(['Closed: 5'])
    const crosshair = chart().querySelector(
        '[data-chart=crosshair]',
    ) as HTMLElement
    // The crosshair stands through the middle of the week's column.
    const week = columns()[1] as ReturnType<typeof columns>[0]
    expect(
        Number.parseFloat(crosshair.style.getPropertyValue('--x')),
    ).toBeCloseTo(week.x + week.width / 2, 1)
    expect(document.querySelector('[data-announce=polite]')?.textContent).toBe(
        'Week of Oct 12, Closed: 5',
    )
    press('Escape')
    expect(chart().hasAttribute('data-hovering')).toBe(false)
})
