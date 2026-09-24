// CANDIDATES FOR THE NEXT 41.9 — clauses no source file and no test cites, in groups where other
// clauses ARE cited.
//
// WHY THIS IS A REPORT AND NOT A GATE. `rulebook.test.ts` catches a citation that DANGLES in both
// directions. What it cannot catch is a citation that still RESOLVES while what it meant moved:
// 41.9 required the client to walk a marker list, the implementation walks child indices and adds
// no marker at all, and every gate stayed green for as long as the number existed. Nothing
// mechanical sees that.
//
// The narrowing is what makes the list readable. Most of the rulebook is a design ahead of its
// implementation — a clause nothing cites is usually a section not built yet, which is the normal
// state here and not a defect. So a group with NO cited clause is skipped entirely, and what is
// left is a clause sitting unreferenced in an area the code has otherwise been written against.
// That is where a rule and its implementation can part company without either looking wrong.
//
// A NAME IN THE OUTPUT IS A LINE TO READ, never a line to change. Whether the clause still
// describes what the code does is the reading; this only says nobody wrote the number down.

import { CITATION, rulebookClauses } from './rulebookClauses.ts'

const ROOT = new URL('../../../', import.meta.url)

const SCANNED = [
    'packages/abide/src',
    'packages/abide/tests',
    'packages/dogfood/tests',
]

// Every `\d.\d` in the file, comment or not. A citation in a string or an identifier is a false
// POSITIVE here — it marks a clause as cited when nothing meant to cite it — and that only ever
// shortens this list. Over-reporting would be the costly direction.
async function citedInSources(): Promise<Set<string>> {
    const cited = new Set<string>()
    const files = new Bun.Glob('**/*.ts')
    for (const directory of SCANNED) {
        const base = new URL(`${directory}/`, ROOT)
        for await (const path of files.scan(base.pathname)) {
            const text = await Bun.file(new URL(path, base)).text()
            for (const found of text.matchAll(CITATION))
                cited.add(found[1] ?? '')
        }
    }
    return cited
}

const rulebook = await Bun.file(new URL('docs/RULEBOOK.md', ROOT)).text()
const cited = await citedInSources()

const groups = new Map<string, { cited: number; uncited: string[] }>()
for (const { id } of rulebookClauses(rulebook)) {
    const group = id.slice(0, id.indexOf('.'))
    const entry = groups.get(group) ?? { cited: 0, uncited: [] }
    if (cited.has(id)) entry.cited += 1
    else entry.uncited.push(id)
    groups.set(group, entry)
}

const ordered = [...groups].sort((a, b) => Number(a[0]) - Number(b[0]))
let candidates = 0
const lines: string[] = []
for (const [group, entry] of ordered) {
    // No clause in the group is cited, so the group is a design nothing has been written against
    // yet. Every clause in it would be a candidate and none of them is a finding.
    if (entry.cited === 0 || entry.uncited.length === 0) continue
    candidates += entry.uncited.length
    lines.push(
        `§${group}  ${String(entry.cited).padStart(3)} cited  ${String(entry.uncited.length).padStart(3)} not   ${entry.uncited.join(' ')}`,
    )
}

console.log(lines.join('\n'))
console.log(
    `\n${candidates} candidates across ${lines.length} groups. A candidate is a line to read.`,
)
