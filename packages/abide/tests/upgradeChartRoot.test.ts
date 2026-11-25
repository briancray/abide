// 38.220 — `abide upgrade` OFF A CHART'S `svg` PART, over a fixture app as an author runs it: a page
// spreading the part in its markup, a module reading it, and a Markdown fence showing it.

import { afterAll, expect, test } from 'bun:test'

import { upgrade } from '#compiler/upgrade.ts'

import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'

afterAll(removeTemporaryModules)

// A NAME BOUND TO `chart(` HAS ITS `svg` READ AS `root`, in its script and its markup, typed or not,
// read through `?.` too. A `pie`'s and a `sparkline`'s `svg` are left, as is one read off a name the
// file binds to anything else, and one read off a longer path; run again the migration changes
// nothing (38.200). THE REVERT: drop the `chart` row from `toNamedParts`' `RENAMES` — nothing is
// changed and `upgrade` answers no edits.
test('abide upgrade renames a chart svg part to root — 38.220, 38.200', async () => {
    const page = `<script>
import { chart, pie, sparkline } from '@abide/abide'

const plot = chart({ label: 'Won', series: [] })
const typed: ChartParts = chart({ label: 'Lost', series: [] })
const ring = pie({ label: 'Stages', slices: [] })
const trend = sparkline({ label: 'Won', values: [] })
const focused = () => plot.svg['aria-describedby']
</script>

<svg {...plot.svg} class="h-48"></svg>
<div {...typed?.svg}></div>
<svg {...ring.svg}></svg>
<svg {...trend.svg}></svg>
<svg {...other.plot.svg}></svg>
`
    const notes = `# Charts

\`\`\`abide
<script>
const won = chart({ label: 'Won', series: [] })
</script>

<svg {...won.svg}></svg>
\`\`\`
`
    const app = temporaryModule({
        'src/index.abide': page,
        'NOTES.md': notes,
        'src/lib/kept.ts': 'export const size = (parts) => parts.svg.width\n',
    })
    const edits = await upgrade(app, '0.143.0')
    const after = (path: string) =>
        edits.find((edit) => edit.path === path)?.after
    expect(after('src/index.abide')).toBe(`<script>
import { chart, pie, sparkline } from '@abide/abide'

const plot = chart({ label: 'Won', series: [] })
const typed: ChartParts = chart({ label: 'Lost', series: [] })
const ring = pie({ label: 'Stages', slices: [] })
const trend = sparkline({ label: 'Won', values: [] })
const focused = () => plot.root['aria-describedby']
</script>

<svg {...plot.root} class="h-48"></svg>
<div {...typed?.root}></div>
<svg {...ring.svg}></svg>
<svg {...trend.svg}></svg>
<svg {...other.plot.svg}></svg>
`)
    expect(after('NOTES.md')).toBe(notes.replace('won.svg', 'won.root'))
    expect(after('src/lib/kept.ts')).toBeUndefined()
    for (const edit of edits) await Bun.write(`${app}/${edit.path}`, edit.after)
    expect(await upgrade(app, '0.143.0')).toEqual([])
})
