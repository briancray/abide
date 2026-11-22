// 51.113, 51.114 — WHAT WAS TYPED, MARKED IN A LABEL by the matcher the list is narrowed by. What
// `Combobox` and `CommandPalette` render of it is the CRM's tests', which mount them.

import { expect, test } from 'bun:test'

import { combobox, commandPalette, flushSync, type LabelRun } from '#shared'

function type(input: Record<string, unknown>, text: string) {
    ;(input.oninput as (event: Event) => void)({
        currentTarget: { value: text },
    } as unknown as Event)
    flushSync()
}

// Each run as its text, a matched one in brackets.
const written = (runs: readonly LabelRun[]) =>
    runs
        .map((run) => (run.match === undefined ? run.text : `[${run.text}]`))
        .join('')

// THE REVERT: find the text in the label lowered, and mark the label as written at that place — `İ`
// lowers to two characters, and `İzmir Co` reads `İzmir C[o]`.
test('an option’s label marks where the typed text is, as the list is narrowed by it — 51.16, 51.113', () => {
    const box = combobox({
        options: ['Hopper & Co', 'İzmir Co', 'Babbage Ltd'],
    })
    box.open.set(true)
    type(box.input, 'cO')
    expect(box.items).toEqual(['Hopper & Co', 'İzmir Co'])
    expect(box.items.map((item) => written(box.runs(item)))).toEqual([
        'Hopper & [Co]',
        'İzmir [Co]',
    ])
    expect(box.runs('Hopper & Co')[1]?.match).toEqual({
        'data-combobox': 'match',
    })
    type(box.input, '')
    expect(written(box.runs('Babbage Ltd'))).toBe('Babbage Ltd')
})

// THE REVERT: mark each word's run on its own, and `hop hopper` marks `Hop` and then `per` apart.
test('a command’s label marks the first place each word typed is, runs that meet marked as one — 51.73, 51.114', () => {
    const palette = commandPalette({
        commands: [
            { label: 'Open Hopper & Co', run: () => {} },
            { label: 'New deal', keywords: ['hopper'], run: () => {} },
        ],
    })
    type(palette.input, 'co hop')
    expect(palette.results.map((command) => command.label)).toEqual([
        'Open Hopper & Co',
    ])
    expect(written(palette.command(palette.results[0]!).runs)).toBe(
        'Open [Hop]per & [Co]',
    )
    type(palette.input, 'hop hopper')
    expect(
        palette.results.map((command) =>
            written(palette.command(command).runs),
        ),
    ).toEqual(['Open [Hopper] & Co', 'New deal'])
})
