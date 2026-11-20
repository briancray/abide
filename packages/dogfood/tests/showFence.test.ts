// AN ANSWER'S `show` BLOCKS AS `showFence` READS THEM: what one names, and when an `open` one has
// closed enough to move the page (40.28).

import { expect, test } from 'bun:test'

import { openedIn, showOf } from '../src/lib/showFence.ts'

test('a show block names one kind and what it shows, and nothing else', () => {
    expect(
        showOf('code="src/activity/lib/QuickLog.abide" from="<script"'),
    ).toEqual({
        kind: 'code',
        value: 'src/activity/lib/QuickLog.abide',
        from: '<script',
    })
    expect(showOf('open="/reactive/watch"')).toEqual({
        kind: 'open',
        value: '/reactive/watch',
    })
    expect(showOf('nonsense')).toBeUndefined()
})

// THE REVERT: drop the closing fence from `OPENED` — the open block still being written moves the
// page as its first line arrives, and this reads `['/a', '/b']`.
test('a show open block moves the page once its fence closes, not before', () => {
    const text =
        'First:\n\n```show open="/a"\n```\n\nThen:\n\n```show open="/b"\n'
    expect(openedIn(text)).toEqual(['/a'])
    expect(openedIn(`${text}\`\`\``)).toEqual(['/a', '/b'])
})
