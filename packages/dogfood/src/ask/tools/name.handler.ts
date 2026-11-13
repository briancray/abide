import { GET } from '@abide/abide/server'

import { registryRows } from '#src/lib/registryRows.ts'
import { SITE } from '#src/lib/SITE.ts'

import REGISTRY from '../../../../../docs/REGISTRY.md' with { type: 'text' }

const ROWS = registryRows(REGISTRY)
const ROUTE_OF = new Map<string, string>()
for (const group of SITE)
    for (const page of group.pages) ROUTE_OF.set(page.registry, page.route)

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
                route: ROUTE_OF.get(row.section) ?? '',
            })
        }
        return rows
    },
    {
        description:
            "The REGISTRY rows for one abide name — `reactive`, `watch`, `route.query` — with each row's signature, its one-sentence meaning, the rulebook clauses that govern it and the page it is on.",
    },
)
