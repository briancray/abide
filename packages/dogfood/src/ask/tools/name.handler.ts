import { GET } from '@abide/abide/server'

import { registryRows } from '#src/lib/registryRows.ts'
import { routeOfSection } from '#src/lib/sitePages.ts'

import REGISTRY from '../../../../../docs/REGISTRY.md' with { type: 'text' }

const ROWS = registryRows(REGISTRY)

export default GET(
    ({ name }: { name: string }) => {
        const rows: {
            name: string
            signature: string
            meaning: string
            rules: string
            route: string
        }[] = []
        for (const row of ROWS) {
            const first = row.cells[0] ?? ''
            if (
                !first.includes(`\`${name}\``) &&
                !first.includes(`\`${name}<`) &&
                !first.includes(`\`${name}.`)
            )
                continue
            rows.push({
                name: first,
                signature: row.cells[1] ?? '',
                meaning: row.cells[2] ?? '',
                rules: row.cells[3] ?? '',
                route: routeOfSection(row.section),
            })
        }
        return rows
    },
    {
        description:
            "The REGISTRY rows for one abide name — `reactive`, `watch`, `route.query` — with each row's signature, its one-sentence meaning, the rulebook clauses that govern it and the page it is on.",
    },
)
