// The `chart` namespace — RULEBOOK 52.19-52.23 and 52.54-52.58, the arithmetic `Chart`, `Pie` and
// `Sparkline` draw with. What the components draw is the CRM's tests', which mount them.

import { expect, test } from 'bun:test'

import {
    nearest,
    path,
    scale,
    stack,
    ticks,
} from '../src/shared/chart/index.ts'

test('ticks are round and enclose the range — 52.19', () => {
    expect(ticks(0, 100, 4)).toEqual([0, 20, 40, 60, 80, 100])
    expect(ticks(0, 1000, 2)).toEqual([0, 500, 1000])
    expect(ticks(3, 97, 5)).toEqual([0, 20, 40, 60, 80, 100])
    expect(ticks(0.1, 0.3, 2)).toEqual([0.1, 0.2, 0.3])
    expect(ticks(-25, 40, 4)).toEqual([-40, -20, 0, 20, 40])
    expect(ticks(5, 5)).toEqual([5, 6, 7])
    expect(ticks(Number.NaN, 1)).toEqual([])
})

test('scale maps a domain onto a range, and a domain of no width to its middle — 52.20', () => {
    const toY = scale([0, 100], [200, 0])
    expect([toY(0), toY(50), toY(100)]).toEqual([200, 100, 0])
    expect(scale([5, 5], [0, 10])(5)).toBe(5)
})

test('path breaks where a value is missing — 52.21', () => {
    expect(path([0, 10, 20, 30, 40], [1, 2, null, 4, 5])).toBe(
        'M0,1L10,2M30,4L40,5',
    )
    expect(path([0, 10, 20], [null, 3, undefined])).toBe('M10,3Z')
    expect(path([0, 10, 20], [1, Number.NaN, 3])).toBe('M0,1ZM20,3Z')
})

test('path closes each run down to a baseline — 52.22', () => {
    expect(path([0, 10], [1, 2], 50)).toBe('M0,1L10,2L10,50L0,50Z')
    expect(path([0, 10, 20, 30], [1, null, 3, 4], 50)).toBe(
        'M0,1L0,50L0,50ZM20,3L30,4L30,50L20,50Z',
    )
})

// THE REVERT: close every run down to `baseline[runStart]` — the second run's floor is flat, 'L30,9L20,9Z'.
test('path closes each run back along a baseline of one point per x — 52.22', () => {
    expect(path([0, 10, 20], [1, 2, 3], [7, 8, 9])).toBe(
        'M0,1L10,2L20,3L20,9L10,8L0,7Z',
    )
    expect(path([0, 10, 20, 30], [1, null, 3, 4], [6, 7, 8, 9])).toBe(
        'M0,1L0,6ZM20,3L30,4L30,9L20,8Z',
    )
})

// THE REVERT: pile negatives on the one running total — the loss stands at 2..1, not 0..-1.
test('a stack piles each x up from zero, positives up and negatives down — 52.54', () => {
    const placed = stack([
        { label: 'Won', values: [2, 3], stack: 'deals' },
        { label: 'Lost', values: [-1, 4], stack: 'deals' },
        { label: 'Open', values: [5, 1], stack: 'deals' },
    ])
    expect(placed.map((each) => [each.low, each.high])).toEqual([
        [
            [0, 0],
            [2, 3],
        ],
        [
            [0, 3],
            [-1, 7],
        ],
        [
            [2, 7],
            [7, 8],
        ],
    ])
})

// THE REVERT: read `stack` before `false` — the target joins the stack, its low [3] where none is due.
test('a series joins the one stack where stacking is on, and false keeps one out — 52.55', () => {
    const series = [
        { label: 'Won', values: [3] },
        { label: 'Lost', values: [2] },
        { label: 'Target', values: [4], stack: false as const },
        { label: 'Forecast', values: [6], stack: 'forecast' },
    ]
    expect(stack(series).map((each) => each.low[0])).toEqual([
        undefined,
        undefined,
        undefined,
        0,
    ])
    expect(
        stack(series, { stack: true }).map((each) => [
            each.low[0],
            each.high[0],
        ]),
    ).toEqual([
        [0, 3],
        [3, 5],
        [undefined, 4],
        [0, 6],
    ])
})

// THE REVERT: leave a missing value out of its stack — Lost reads nothing at the first x, where it
// stands at 2..2 on top of Won.
test('a missing value is zero toward its stack — 52.56', () => {
    const placed = stack(
        [
            { label: 'Won', values: [2, 2] },
            { label: 'Lost', values: [null, 1] },
            { label: 'Open', values: [1, 1] },
        ],
        { stack: true },
    )
    expect(placed[1]).toEqual({ low: [2, 2], high: [2, 3], stack: '' })
    expect(placed[2]).toEqual({ low: [2, 3], high: [3, 4], stack: '' })
})

// THE REVERT: divide by the signed sum — the x of 3 and -1 reads 1.5 and -0.5 where 0.75 and -0.25
// are due, and the x summing to nothing reads NaN.
test('normalize answers each value as its share of its stack, stacking on its own — 52.57, 52.58', () => {
    const placed = stack(
        [
            { label: 'Won', values: [3, 0, 1] },
            { label: 'Lost', values: [-1, 0, 3] },
            { label: 'Target', values: [9, 9, 9], stack: false },
        ],
        { normalize: true },
    )
    expect(placed[0]).toEqual({
        low: [0, 0, 0],
        high: [0.75, 0, 0.25],
        stack: '',
    })
    expect(placed[1]).toEqual({
        low: [0, 0, 0.25],
        high: [-0.25, 0, 1],
        stack: '',
    })
    expect(placed[2]?.high).toEqual([9, 9, 9])
})

test('nearest finds the position nearest x — 52.23', () => {
    expect(nearest([0, 10, 20, 30], 14)).toBe(1)
    expect(nearest([0, 10, 20, 30], 15)).toBe(1)
    expect(nearest([0, 10, 20, 30], 16)).toBe(2)
    expect(nearest([0, 10, 20, 30], -5)).toBe(0)
    expect(nearest([0, 10, 20, 30], 99)).toBe(3)
    expect(nearest([], 4)).toBe(-1)
})
