// WHAT AN INLINE COMPONENT COSTS A ROW. `{#component Name(pattern)}` written in a `{#for}` row is a
// function declared in the row's mount, closing over the row (32.42), so a row that declares one
// pays a closure per mount whether or not it invokes it — and a row that invokes it pays the
// invocation a file component does. This prices both at the n where a row cost could cross a frame.
//
// THE OP IS A KEYED `replace`, as in `selectedRowShare.ts`. Every arm reads page state (`selected`),
// so the row's mount is never the shared empty one and the declaration is emitted in each (a region
// that mounts nothing declares nothing, 32.43).
//
// `bun packages/abide/bench/inlineRowShare.ts [rows]`

import { priceRowArms, replacePage } from './priceRowArms.ts'

const ROWS = Number(process.argv[2] ?? '1000')

const LABEL = `<script>
import { props } from '@abide/abide'

const { label } = props<{ label: string }>()
</script>
<span>{label}</span>`

await priceRowArms(
    ROWS,
    {
        // THE ROW WITHOUT ONE: what every other arm is read against.
        'plain row': {
            source: replacePage(
                ROWS,
                '<li aria-selected={selected === row.id}><span>{row.label}</span></li>',
            ),
        },
        // THE DECLARATION ALONE: the same row, and a component it declares and never invokes.
        declared: {
            source: replacePage(
                ROWS,
                '{#component Mark()}<b>{row.label}</b>{/component}<li aria-selected={selected === row.id}><span>{row.label}</span></li>',
            ),
        },
        // DECLARED AND INVOKED: the `<span>` written by an inline component that reads the row.
        invoked: {
            source: replacePage(
                ROWS,
                '{#component Label()}<span>{row.label}</span>{/component}<li aria-selected={selected === row.id}><Label/></li>',
            ),
        },
        // THE SAME `<span>` FROM A FILE: the invocation with no declaration, handed the row as a prop.
        'file component': {
            source: replacePage(
                ROWS,
                '<li aria-selected={selected === row.id}><Label label={row.label}/></li>',
                "import Label from './Label.abide'",
            ),
            components: { Label: LABEL },
        },
    },
    // THE DECLARATION IS CHECKED, not assumed: an arm whose row mount declares nothing is the
    // plain row under another name.
    (script) =>
        /\b(Mark|Label) = function\b|function (Mark|Label)\b/.test(script)
            ? 'declares'
            : '        ',
)
