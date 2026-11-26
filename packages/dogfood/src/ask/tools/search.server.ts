import { rpc } from '@abide/abide/server'

import { REGISTRY_ROWS } from '#src/lib/REGISTRY_ROWS.server.ts'
import { SITE } from '#src/lib/SITE.ts'
import { routeOfSection } from '#src/lib/sitePages.ts'
import { CLAUSE_TEXTS } from '#src/rulebook/lib/CLAUSE_TEXTS.server.ts'

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

export default rpc(
    ({ query }: { query: string }) => {
        const words = query
            .toLowerCase()
            .split(/\s+/)
            .filter((word) => word.length > 1)
        const pages: {
            hit: { route: string; title: string; description: string }
            score: number
        }[] = []
        for (const group of SITE)
            for (const page of group.pages) {
                const found = score(
                    `${page.title} ${page.description} ${group.group}`,
                    words,
                )
                if (found > 0)
                    pages.push({
                        hit: {
                            route: page.route,
                            title: page.title,
                            description: page.description,
                        },
                        score: found,
                    })
            }
        const names: {
            hit: { name: string; meaning: string; route: string }
            score: number
        }[] = []
        for (const row of REGISTRY_ROWS) {
            const found = score(row.cells.join(' '), words)
            if (found > 0)
                names.push({
                    hit: {
                        name: row.cells[0] ?? '',
                        meaning: row.cells[2] ?? '',
                        route: routeOfSection(row.section),
                    },
                    score: found,
                })
        }
        const clauses: {
            hit: { number: string; text: string }
            score: number
        }[] = []
        for (const [number, text] of CLAUSE_TEXTS) {
            const found = score(text, words)
            if (found > 0)
                clauses.push({
                    hit: { number, text },
                    score: found,
                })
        }
        return {
            pages: best(pages),
            names: best(names),
            clauses: best(clauses),
        }
    },
    {
        description:
            'Search the abide docs by words: the pages, the REGISTRY rows and the rulebook clauses holding every word of `query`, best first.',
    },
)
