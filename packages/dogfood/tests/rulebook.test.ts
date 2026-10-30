import { expect, test } from 'bun:test'

import { SyntaxKind } from 'typescript/unstable/ast'

import { tokenize } from '../../abide/src/compiler/tokenize.ts'
import { rulebookClauses } from '../scripts/rulebookClauses.ts'

// REGISTRY.md holds signatures and RULEBOOK.md holds requirements, and the split is only worth
// having if it STAYS split. Prose at the top of a document does not make it stay — a rule written
// into a registry cell reads perfectly, and so does a signature in a clause.
//
// So the format rules each document states are checked here, in both directions: a requirement
// leaking into the registry, and a type leaking into the rulebook.

const DOCS = new URL('../../../docs/', import.meta.url)

const registry = await Bun.file(new URL('REGISTRY.md', DOCS)).text()
const rulebook = await Bun.file(new URL('RULEBOOK.md', DOCS)).text()

// The format-rule preamble of each document states these keywords, so the checks below run over
// the BODY — everything from the first `# ` heading that is not the document's own title. The
// preamble's own headings are all `##`, which is what makes the first `\n# ` the boundary.
function body(source: string): string {
    const start = source.indexOf('\n# ')
    return start === -1 ? '' : source.slice(start)
}

// A table row, minus its code spans: a name, a signature and a clause list are all legitimately
// full of the punctuation these checks look for.
function rows(source: string): { line: number; cells: string[] }[] {
    const out: { line: number; cells: string[] }[] = []
    const lines = body(source).split('\n')
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? ''
        if (!line.startsWith('|') || /^\|\s*-/.test(line)) continue
        const cells = line.replace(/^\||\|$/g, '').split(/(?<!\\)\|/)
        // A header row, whatever its first column is called — `Name` here, `Context` in Tracking.
        if (cells[cells.length - 1]?.trim() === 'Rules') continue
        out.push({ line: index + 1, cells: cells.map((cell) => cell.trim()) })
    }
    return out
}

function clauses(): { id: string; text: string }[] {
    return rulebookClauses(body(rulebook))
}

// The categories the clauses are written over, read from the rulebook's own Terms table rather
// than listed here — a term added there without a definition is what this would otherwise miss.
const TERMS = (() => {
    const table = rulebook.slice(
        rulebook.indexOf('| Term | Definition |'),
        rulebook.indexOf('RFC 2119'),
    )
    const terms: string[] = []
    for (const row of table.split('\n')) {
        const term = /^\| ([a-z]+(?: [a-z]+)*) \| \S/.exec(row)
        if (term?.[1]) terms.push(term[1])
    }
    return terms
})()

const REQUIREMENT = /\b(MUST NOT|MUST|SHALL NOT|SHALL|SHOULD NOT|SHOULD|MAY)\b/

// RULEBOOK format rule 5 calls "because" the tell, and a check that greps the tell alone catches
// the word rather than the rationale: nine clauses carried their reason behind `so that` instead,
// one conjunction over from the banned one. The rule is no rationale, so the check is every way a
// clause reaches for one.
const RATIONALE = /\b(because|so that|in order to|which is why)\b/

// REGISTRY format rule 3. A requirement in a meaning cell is the whole failure mode this split
// exists for: it reads as documentation and it is a second home for a rule that has a number.
test('no registry row states a requirement', async () => {
    const offenders: string[] = []
    for (const { line, cells } of rows(registry)) {
        const meaning = cells[cells.length - 2] ?? ''
        if (REQUIREMENT.test(meaning))
            offenders.push(`REGISTRY.md:${line}: ${cells[0]}`)
    }
    expect(offenders).toEqual([])
})

// REGISTRY format rule 2. The one-sentence rule is what actually holds the line — a second
// sentence is a rule every time, and it is checkable where "is this a rule?" is not. Code spans
// are blanked first, a signature carrying a `.` in every member otherwise reading as ten sentences.
test('a registry meaning is one sentence', async () => {
    const offenders: string[] = []
    for (const { line, cells } of rows(registry)) {
        const meaning = (cells[cells.length - 2] ?? '').replace(
            /`[^`]*`/g,
            'CODE',
        )
        if (
            meaning.split(/[.!?](?:\s|$)/).filter((part) => part.trim())
                .length > 1
        )
            offenders.push(`REGISTRY.md:${line}: ${cells[0]}`)
    }
    expect(offenders).toEqual([])
})

// RULEBOOK format rule 3. A signature in a clause is the same leak in the other direction, and a
// function arrow is the one mark that cannot be anything else.
test('no clause carries a signature', async () => {
    const offenders: string[] = []
    for (const { id, text } of clauses())
        if (text.includes('=>')) offenders.push(id)
    expect(offenders).toEqual([])
})

// RULEBOOK format rule 4. A clause naming nothing constrains nothing that can be found again —
// so it names a REGISTRY entry, or one of the categories the Terms table defines. Checked against
// that table rather than a list here, so a clause cannot invent a category by using one.
test('every clause names something', async () => {
    expect(TERMS.length).toBeGreaterThan(5)
    const offenders: string[] = []
    for (const { id, text } of clauses()) {
        if (text.includes('`')) continue
        if (TERMS.some((term) => new RegExp(`\\b${term}\\b`).test(text)))
            continue
        offenders.push(id)
    }
    expect(offenders).toEqual([])
})

// RULEBOOK format rule 5. "because" is the tell for a reason, which belongs in a guide.
test('no clause explains itself', async () => {
    const offenders: string[] = []
    for (const { id, text } of clauses())
        if (RATIONALE.test(text)) offenders.push(id)
    expect(offenders).toEqual([])
})

// RULEBOOK format rule 1. Every clause states a requirement, or it is a note that has been filed
// as one — which is how a rulebook silently becomes prose again.
test('every clause states a requirement', async () => {
    const offenders: string[] = []
    for (const { id, text } of clauses())
        if (!REQUIREMENT.test(text)) offenders.push(id)
    expect(offenders).toEqual([])
})

// RULEBOOK format rule 7, and the half of it a reader can see. A rule that stops holding is
// DELETED — a stub left in its place reading "Withdrawn, superseded by 5.4" still parses as a
// clause, so `clauses()` counts it, "every clause states a requirement" passes on the MUST inside
// the sentence it quotes, and a citation of the dead number resolves through every gate in this
// file. Two of them sat that way through a renumber.
//
// THE REVERT: putting either stub back reports its number against an empty list.
const RETIRED = /\bWithdrawn\b|\bsupersede[ds]\b/i

test('no clause is a stub for a deleted rule', async () => {
    const offenders: string[] = []
    for (const { id, text } of clauses())
        if (RETIRED.test(text)) offenders.push(id)
    expect(offenders).toEqual([])
})

// The other half of format rule 7: the clauses after a deleted one CLOSE THE GAP. A deletion that
// renumbers nothing is invisible here — every remaining clause is still valid, still cited, still
// unique — and the hole it leaves is where the next rule gets numbered, which is how one number
// comes to mean two things across two sessions.
//
// THE REVERT: deleting 5.4 without renumbering reports the whole tail of group 5, from
// `5: 5 after 5.3` down — one deletion is every later number, which is the point.
test('a clause group is numbered from 1 with no gap', async () => {
    const groups = new Map<number, number[]>()
    for (const { id } of clauses()) {
        const [group, ordinal] = id.split('.').map(Number)
        if (group === undefined || ordinal === undefined) continue
        groups.set(group, [...(groups.get(group) ?? []), ordinal])
    }
    expect(groups.size).toBeGreaterThan(10)
    const gaps: string[] = []
    for (const [group, ordinals] of groups) {
        for (let index = 0; index < ordinals.length; index += 1) {
            if (ordinals[index] !== index + 1)
                gaps.push(
                    `${group}: ${ordinals[index]} after ${group}.${index}`,
                )
        }
    }
    expect(gaps).toEqual([])
})

// The check above walks the clauses INSIDE a group, so a whole group missing went unseen: the
// headings ran 42, 44 for as long as nothing looked at them.
//
// THE REVERT: renumbering `# 43.` back to `# 44.` reports `44 where 43` and the contents line
// that no longer matches a heading.
test('the groups are numbered from 1 with no gap, and the contents list each one', async () => {
    const headings = [...rulebook.matchAll(/^# (\d+)\. (.+)$/gm)].map(
        (match) => `${match[1]}. ${match[2]}`,
    )
    const gaps: string[] = []
    for (let index = 0; index < headings.length; index += 1) {
        const number = Number.parseInt(headings[index] ?? '', 10)
        if (number !== index + 1) gaps.push(`${number} where ${index + 1}`)
    }
    expect(gaps).toEqual([])
    const contents = [...rulebook.matchAll(/^- \[(\d+\. .+)\]\(#(\d+)\)$/gm)]
    expect(contents.map((match) => match[1])).toEqual(headings)
    for (const match of contents)
        expect(match[1]?.startsWith(`${match[2]}. `)).toBe(true)
})

test('no clause number is used twice', async () => {
    const seen = new Set<string>()
    const doubled: string[] = []
    for (const { id } of clauses()) {
        if (seen.has(id)) doubled.push(id)
        seen.add(id)
    }
    expect(doubled).toEqual([])
})

// The two documents are joined by the `Rules` cell and by nothing else, so a citation that names
// no clause is the join coming apart — and it is silent, both files staying valid alone.
test('every rule a registry row cites exists', async () => {
    const ids = new Set(clauses().map((clause) => clause.id))
    const dangling: string[] = []
    for (const { line, cells } of rows(registry)) {
        const cited = cells[cells.length - 1] ?? ''
        if (cited === '—' || !cited) continue
        for (const id of cited.split(',')) {
            if (!ids.has(id.trim()))
                dangling.push(`REGISTRY.md:${line}: ${id.trim()}`)
        }
    }
    expect(dangling).toEqual([])
})

// The other direction. A clause nothing cites is a rule about a name the registry does not carry,
// which is either a missing row or a rule for a section not converted yet — and both are worth
// seeing rather than accumulating.
//
// A group may EXCUSE itself, per format rule 6, and the excuse is read out of the rulebook rather
// than listed here — so exempting a group is an edit a reviewer sees in the document rather than
// one buried in a test.
function freeStanding(): Set<string> {
    const groups = new Set<string>()
    for (const match of body(rulebook).matchAll(
        /^# (\d+)\.[^\n]*\n\n\*Free-standing:/gm,
    )) {
        groups.add(match[1] ?? '')
    }
    return groups
}

test('every clause is cited by a registry row', async () => {
    const cited = new Set<string>()
    for (const { cells } of rows(registry)) {
        for (const id of (cells[cells.length - 1] ?? '').split(','))
            cited.add(id.trim())
    }
    const excused = freeStanding()
    expect(excused.size).toBeGreaterThan(0)
    const orphans: string[] = []
    for (const { id } of clauses()) {
        if (cited.has(id) || excused.has(id.slice(0, id.indexOf('.')))) continue
        orphans.push(id)
    }
    expect(orphans).toEqual([])
})

// A rulebook GROUP that states no requirement, or a REGISTRY section no group governs, is a place
// where a rule can go missing without anything saying so. A row-for-row count cannot see it: a
// section with no table rows passes a count without being read.
test('every registry section is governed by some clause', async () => {
    const registry = await Bun.file(new URL('REGISTRY.md', DOCS)).text()
    const sections = new Map<string, string[]>()
    let section = ''
    for (const line of registry.split('\n')) {
        if (line.startsWith('## ')) {
            section = line.slice(3).trim()
            continue
        }
        if (line.startsWith('# ')) section = line.slice(2).trim()
        if (!line.startsWith('| `') && !line.startsWith('| formatting'))
            continue
        const cells = line
            .replace(/^\|/, '')
            .replace(/(?<!\\)\|$/, '')
            .split(/(?<!\\)\|/)
        const cited = cells.at(-1)?.trim() ?? ''
        sections.set(section, [...(sections.get(section) ?? []), cited])
    }
    const ungoverned: string[] = []
    for (const [name, cells] of sections) {
        if (cells.some((cell) => cell !== '—' && cell !== '')) continue
        ungoverned.push(name)
    }
    expect(ungoverned).toEqual([])
})

test('every clause group states a requirement', async () => {
    const empty: string[] = []
    for (const group of body(rulebook).split(/\n# /).slice(1)) {
        const heading = group.split('\n')[0] ?? ''
        if (!/^\d+\./.test(heading)) continue
        if (!REQUIREMENT.test(group)) empty.push(heading)
    }
    expect(empty).toEqual([])
})

// BRAND.md cites the rulebook rather than paraphrasing it. A claims column that restates mechanism
// is a second copy that goes stale silently, and a document with nowhere to send a statement keeps
// it — so the checks below hold BRAND to citing, and hold its citations to resolving.
const brand = await Bun.file(new URL('BRAND.md', DOCS)).text()

// As with the other three: the format rules NAME the keywords they refuse, so the checks read the
// body and the preamble states the contract.
const brandBody = brand.slice(
    brand.indexOf('\n# ', brand.indexOf('## Format rules')),
)

// BRAND format rule 2.
test('no brand statement carries a requirement keyword', async () => {
    const offenders: string[] = []
    for (const line of brandBody.split('\n')) {
        if (REQUIREMENT.test(line.replaceAll(/`[^`]*`/g, 'CODE')))
            offenders.push(line.trim().slice(0, 70))
    }
    expect(offenders).toEqual([])
})

// BRAND format rule 3. A brand citing a deleted file makes a claim about a source nobody can read,
// and the bare word is what a path check misses.
test('every document the brand names exists', async () => {
    const missing: string[] = []
    for (const match of brand.matchAll(/\b(?:docs\/)?([A-Z][A-Z_]+)\.md\b/g)) {
        const name = `${match[1] ?? ''}.md`
        const beside = await Bun.file(new URL(name, DOCS)).exists()
        const root = await Bun.file(new URL(`../${name}`, DOCS)).exists()
        if (!beside && !root) missing.push(name)
    }
    // The bare word a path check cannot see: a deletion leaves the word behind in a
    // sentence, still asserting which document wins a disagreement.
    for (const gone of ['SPEC', 'DECISIONS'])
        if (new RegExp(`\\b${gone}\\b`).test(brand)) missing.push(gone)
    expect([...new Set(missing)]).toEqual([])
})

// BRAND format rule 1. A claim cites a clause, and the citation has to resolve — otherwise the
// column reads as authority and points at nothing. Every citation in the document is read, not
// just the load-bearing claims table.
test('every clause the brand cites exists', async () => {
    const ids = new Set(clauses().map((clause) => clause.id))
    const dangling: string[] = []
    for (const line of brandBody.split('\n')) {
        for (const match of line.matchAll(/\b(\d+\.\d+)\b/g)) {
            if (!ids.has(match[1] ?? '')) dangling.push(match[1] ?? '')
        }
    }
    expect([...new Set(dangling)]).toEqual([])
})

// CLAUDE.md is the document every session reads first, and it named none of the other four while
// restating three of their rules — the by-name rule, the widening schema, and isomorphism, each
// written out in a second register with nothing comparing the two. It now cites instead, and a
// citation that stops resolving is the same silent staleness BRAND already had a check for.
test('every clause the working notes cite exists', async () => {
    const notes = await Bun.file(new URL('../CLAUDE.md', DOCS)).text()
    const ids = new Set(clauses().map((clause) => clause.id))
    const groups = new Set(
        [...body(rulebook).matchAll(/^# (\d+)\./gm)].map((group) => group[1]),
    )
    const dangling: string[] = []
    // A citation is a list of clauses, ranges (`40.6-40.10`, both ends read) and whole groups
    // (`RULEBOOK 40`), joined by commas and `and`.
    for (const match of notes.matchAll(
        /RULEBOOK ((?:\d+(?:\.\d+)?(?:-\d+\.\d+)?(?:,? (?:and )?)?)+)/g,
    )) {
        for (const id of (match[1] ?? '').matchAll(/\d+\.\d+|\d+/g)) {
            const known = id[0].includes('.')
                ? ids.has(id[0])
                : groups.has(id[0])
            if (!known) dangling.push(id[0])
        }
    }
    expect(dangling.length === 0 && ids.size > 0).toBe(true)
    expect([...new Set(dangling)]).toEqual([])
})

// The check above reads only what follows the word RULEBOOK, so a bare `(40.17, 40.18)` in the
// notes resolves or dangles with nothing looking. A parenthesized clause number is a citation, and
// one written without its document is one the check cannot see.
test('every clause the working notes cite names its document', async () => {
    const notes = await Bun.file(new URL('../CLAUDE.md', DOCS)).text()
    const bare: string[] = []
    for (const match of notes.matchAll(/\((\d+\.\d+)[,)-]/g)) {
        bare.push(match[0])
    }
    expect(bare).toEqual([])
})

// And the routing itself: a session told to read a document that is not there has been sent
// nowhere.
test('every document the working notes name exists', async () => {
    const notes = await Bun.file(new URL('../CLAUDE.md', DOCS)).text()
    const missing: string[] = []
    for (const match of notes.matchAll(/`docs\/([A-Z][A-Z_]+\.md)`/g)) {
        if (!(await Bun.file(new URL(match[1] ?? '', DOCS)).exists()))
            missing.push(match[1] ?? '')
    }
    expect(missing.length).toBe(0)
    expect([...new Set(missing)]).toEqual([])
})

// THE FRAMEWORK'S OWN MESSAGES CITE THE RULEBOOK TOO, and in the same two ways the notes can go
// wrong: a `RULEBOOK n.n` a renumber left behind points an author at the wrong rule, and a bare
// `(41.10)` names no document at all, so nothing looks at it. Read off the string literals alone —
// a comment's citation is the notes' business, not an author's — through the compiler's own
// scanner, so a template literal's text is a string and its substitutions are not.
//
// THE REVERT: plant `RULEBOOK 99.1` or a bare `(41.10)` in any message under packages/abide/src;
// the first test names it as dangling, the second as bare.
const FRAMEWORK = new URL('../../abide/src/', import.meta.url)
const STRINGS = new Set([
    SyntaxKind.StringLiteral,
    SyntaxKind.NoSubstitutionTemplateLiteral,
    SyntaxKind.TemplateHead,
    SyntaxKind.TemplateMiddle,
    SyntaxKind.TemplateTail,
])

async function frameworkStrings(): Promise<{ file: string; text: string }[]> {
    const found: { file: string; text: string }[] = []
    for await (const file of new Bun.Glob('**/*.ts').scan(FRAMEWORK.pathname)) {
        const source = await Bun.file(new URL(file, FRAMEWORK)).text()
        for (const token of tokenize(source))
            if (STRINGS.has(token.kind)) found.push({ file, text: token.text })
    }
    return found
}

test('every clause a framework message cites exists', async () => {
    const ids = new Set(clauses().map((clause) => clause.id))
    const dangling: string[] = []
    let cited = 0
    for (const { file, text } of await frameworkStrings())
        for (const match of text.matchAll(
            /RULEBOOK ((?:\d+\.\d+(?:-\d+\.\d+)?(?:,? (?:and |or )?)?)+)/g,
        ))
            for (const id of (match[1] ?? '').matchAll(/\d+\.\d+/g)) {
                cited += 1
                if (!ids.has(id[0])) dangling.push(`${file}: ${id[0]}`)
            }
    expect(cited).toBeGreaterThan(100)
    expect(dangling).toEqual([])
})

test('every clause a framework message cites names its document', async () => {
    const bare: string[] = []
    for (const { file, text } of await frameworkStrings())
        for (const match of text.matchAll(/(?<![\w$])\((\d+\.\d+)[,)-]/g))
            bare.push(`${file}: ${match[0]}`)
    expect(bare).toEqual([])
})
