import { GET } from '@abide/abide/server'

import { registryRows } from '#src/lib/registryRows.ts'
import { SITE } from '#src/lib/SITE.ts'
import { rulebookClauses } from '#src/rulebook/lib/rulebookClauses.ts'

import REGISTRY from '../../../../../docs/REGISTRY.md' with { type: 'text' }
import RULEBOOK from '../../../../../docs/RULEBOOK.md' with { type: 'text' }

const ROWS = registryRows(REGISTRY)
const CLAUSES = rulebookClauses(RULEBOOK)
const LIMIT = 12

// A hit is a text holding every word of the query, scored by how often they appear in it.
function score(text: string, words: readonly string[]): number {
    const lower = text.toLowerCase()
    let total = 0
    for (const word of words) {
        const count = lower.split(word).length - 1
        if (count === 0) return 0
        total += count
    }
    return total
}

function best<Hit>(hits: { hit: Hit; score: number }[]): Hit[] {
    hits.sort((a, b) => b.score - a.score)
    const kept: Hit[] = []
    for (const one of hits.slice(0, LIMIT)) kept.push(one.hit)
    return kept
}

export default GET(
    ({ query }: { query: string }) => {
        const words = query.toLowerCase().split(/\s+/).filter((word) => word.length > 1)
        const pages: { hit: { route: string; title: string; description: string }; score: number }[] = []
        const routeOf = new Map<string, string>()
        for (const group of SITE)
            for (const page of group.pages) {
                routeOf.set(page.registry, page.route)
                const found = score(`${page.title} ${page.description} ${group.group}`, words)
                if (found > 0)
                    pages.push({ hit: { route: page.route, title: page.title, description: page.description }, score: found })
            }
        const names: { hit: { name: string; meaning: string; route: string }; score: number }[] = []
        for (const row of ROWS) {
            const found = score(row.cells.join(' '), words)
            if (found > 0)
                names.push({
                    hit: { name: row.cells[0] ?? '', meaning: row.cells[2] ?? '', route: routeOf.get(row.section) ?? '' },
                    score: found,
                })
        }
        const clauses: { hit: { number: string; text: string }; score: number }[] = []
        for (const clause of CLAUSES) {
            const found = score(clause.text, words)
            if (found > 0) clauses.push({ hit: { number: clause.id, text: clause.text }, score: found })
        }
        return { pages: best(pages), names: best(names), clauses: best(clauses) }
    },
    {
        description:
            'Search the abide docs by words: the pages, the REGISTRY rows and the rulebook clauses holding every word of `query`, best first.',
    },
)
