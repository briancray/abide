import { expect, test } from 'bun:test'

// REGISTRY.md and RULEBOOK.md were split out of SPEC.md because one table cell was carrying five
// kinds of statement at once: `identity` held a signature, fifteen rules, the rationale for a
// default, three measurements and an unpaid TODO. The split is only worth having if it STAYS split,
// and prose at the top of a document does not make it stay — a rule written into a registry cell
// reads perfectly, and so does a signature in a clause.
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
    const out: { id: string; text: string }[] = []
    for (const paragraph of body(rulebook).split('\n\n')) {
        const clause = /^(\d+\.\d+)\s+([\s\S]*)$/.exec(paragraph.trim())
        // A WITHDRAWN clause is still a number — format rule 7 keeps it in place so a citation
        // written before the withdrawal resolves to the withdrawal rather than to silence — but it
        // states no requirement and names nothing, so the checks over live clauses skip it.
        if (clause && !(clause[2] ?? '').startsWith('*Withdrawn'))
            out.push({
                id: clause[1] ?? '',
                text: (clause[2] ?? '').replace(/\n/g, ' '),
            })
    }
    return out
}

// A withdrawal has to SAY what replaced it, or a reader following an old citation lands on a hole.
function withdrawn(): { id: string; text: string }[] {
    const out: { id: string; text: string }[] = []
    for (const paragraph of body(rulebook).split('\n\n')) {
        const clause = /^(\d+\.\d+)\s+(\*Withdrawn[\s\S]*)$/.exec(
            paragraph.trim(),
        )
        if (clause)
            out.push({
                id: clause[1] ?? '',
                text: (clause[2] ?? '').replace(/\n/g, ' '),
            })
    }
    return out
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
        const term = /^\| ([a-z]+) \| \S/.exec(row)
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

// THE MIGRATION PROOF HAD A BLIND SPOT AND THIS IS IT. `SPEC.md` was converted under a row-for-row
// count — 310 rows in, 310 out — and a section with no table rows passed that count without being
// read: 389 lines across ten sections, of which Props, `<head>`, view transitions and the whole
// Documentation section were never converted at all, and were deleted with the file.
//
// A count cannot come back, `SPEC.md` being gone. What replaces it is the property the count was
// standing in for: a rulebook GROUP that states no requirement, or a REGISTRY section no group
// governs, is a place where a rule can go missing without anything saying so.
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

// BRAND.md is the fourth document and the one with no contract until now, which is how it ended up
// holding a PARAPHRASE of the rulebook: its claims column restated mechanism at length instead of
// citing it, and two of its sentences had gone stale without anything noticing — one naming
// `SPEC.md` after that file was deleted, and one asserting that `{% lead %}` is RULEBOOK's, which a
// mechanical rename had made false. A document with nowhere to send a statement keeps it.
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
// and the bare word is what a path check misses — `SPEC.md` survived as "SPEC" in a sentence after
// every `docs/SPEC.md` had been renamed.
test('every document the brand names exists', async () => {
    const missing: string[] = []
    for (const match of brand.matchAll(/\b(?:docs\/)?([A-Z][A-Z_]+)\.md\b/g)) {
        const name = `${match[1] ?? ''}.md`
        const beside = await Bun.file(new URL(name, DOCS)).exists()
        const root = await Bun.file(new URL(`../${name}`, DOCS)).exists()
        if (!beside && !root) missing.push(name)
    }
    // The bare word a path check cannot see: every `docs/SPEC.md` was renamed and "SPEC" survived
    // in a sentence, still asserting which document wins a disagreement.
    if (/\bSPEC\b/.test(brand)) missing.push('SPEC')
    expect([...new Set(missing)]).toEqual([])
})

// BRAND format rule 1. A claim cites a clause, and the citation has to resolve — otherwise the
// column reads as authority and points at nothing.
//
// THIS READ ONE TABLE. `if (!line.startsWith('| **')) continue` meant only the nine Load-bearing
// claims rows were ever checked, and the fourteen citations everywhere else — the example rules,
// the documentation structure, the vocabulary cells — were invisible to the check that claims to
// enforce rule 1 generally. They all resolved, so this closes a gap rather than a break.
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

// And the other citation BRAND makes. `every decision a clause cites exists` joins RULEBOOK to
// DECISIONS and nothing joined BRAND to it, so a `D44` here was checked in neither direction.
test('every decision the brand cites exists', async () => {
    const decisions = await Bun.file(new URL('DECISIONS.md', DOCS)).text()
    const declared = new Set(
        [...decisions.matchAll(/^# (D\d+)\./gm)].map((match) => match[1] ?? ''),
    )
    const dangling: string[] = []
    for (const match of brandBody.matchAll(/\b(D\d+)\b/g)) {
        if (!declared.has(match[1] ?? '')) dangling.push(match[1] ?? '')
    }
    expect([...new Set(dangling)]).toEqual([])
})

// A REVERSED entry is a historical record, exactly as a withdrawn clause is — format rule 5 keeps
// it in place so an old `See D3` resolves to the reversal rather than to silence. Its `Decides:`
// and `Assumes:` therefore name what it decided and rested on WHEN IT HELD, and those clauses may
// since have been withdrawn. So the two citation checks below read live entries, the same way
// `clauses()` reads live clauses, and the reversal is what excuses it.
function decisionEntries(
    source: string,
): { text: string; reversed: boolean }[] {
    const out: { text: string; reversed: boolean }[] = []
    for (const block of source.split(/^# D\d+\./m).slice(1)) {
        out.push({ text: block, reversed: /\*Reversed by D\d+/.test(block) })
    }
    return out
}

// A DECISION CITING A CLAUSE THAT WAS NEVER WRITTEN is the shape the recovery audit ended on: D7
// said it was "what licenses deriving `cache-control` from a global memo's ttl", and no clause said
// the derivation happened. The decision read as authority over a rule that did not exist, and the
// citation check only ran the other way — registry to clause — so nothing looked at this direction.
test('every clause a decision cites exists', async () => {
    const decisions = await Bun.file(new URL('DECISIONS.md', DOCS)).text()
    const ids = new Set(clauses().map((clause) => clause.id))
    const dangling: string[] = []
    const live = decisionEntries(decisions).filter((entry) => !entry.reversed)
    for (const line of live.flatMap((entry) => entry.text.split('\n'))) {
        if (!line.startsWith('**Decides:**')) continue
        for (const match of line.matchAll(/\b(\d+\.\d+)\b/g)) {
            if (!ids.has(match[1] ?? '')) dangling.push(match[1] ?? '')
        }
    }
    expect([...new Set(dangling)]).toEqual([])
})

// DECISIONS format rule 6. A DECISION OUTLIVING ITS PREMISE is the failure `Decides:` cannot see.
// D3 refused propagating `refreshing` because `pending` was monotone and so derivable on the walk
// the body's reads already make. D55 then decided that an invalidated value reads as pending, which
// re-arms it — and nothing failed, because the two entries never contradicted each other. One
// stated a rule and the other stated a reason, and only the reason stopped being true.
//
// So an entry says what it rested on, and the citation is what a later amendment gets grepped
// against. The mechanical half is here: an assumed clause has to be LIVE, so withdrawing one
// surfaces every decision standing on it. The half no check can do is reading the amended clause
// against the entry, and rule 6 plus this citation is what puts a name in front of whoever does.
test('every clause a decision assumes is live', async () => {
    const decisions = await Bun.file(new URL('DECISIONS.md', DOCS)).text()
    const ids = new Set(clauses().map((clause) => clause.id))
    const dangling: string[] = []
    const live = decisionEntries(decisions).filter((entry) => !entry.reversed)
    for (const line of live.flatMap((entry) => entry.text.split('\n'))) {
        if (!line.startsWith('**Assumes:**')) continue
        for (const match of line.matchAll(/\b(\d+\.\d+)\b/g)) {
            if (!ids.has(match[1] ?? '')) dangling.push(match[1] ?? '')
        }
    }
    expect([...new Set(dangling)]).toEqual([])
})

// THE CITATION CHECKS RAN ONE WAY AND THIS IS THE HOLE THAT LEFT. `every decision is cited by a
// clause` reads DECISIONS and asks the rulebook; nothing read the rulebook and asked DECISIONS, so
// five clauses shipped citing D29 through D33 — entries the split never wrote. Each said "a reason
// exists for this" and sent a maintainer nowhere, which is worse than saying nothing: 39.8 refuses
// an option a future session reverses precisely because no record says why.
test('every decision a clause cites exists', async () => {
    const decisions = await Bun.file(new URL('DECISIONS.md', DOCS)).text()
    const declared = new Set(
        [...decisions.matchAll(/^# (D\d+)\./gm)].map((match) => match[1] ?? ''),
    )
    // Whitespace-normalised for the same reason the reverse check is: a citation may wrap a line.
    const flat = rulebook.replace(/\s+/g, ' ')
    const cited = [...flat.matchAll(/\bSee (D\d+)\b/g)].map(
        (match) => match[1] ?? '',
    )
    expect([...new Set(cited.filter((entry) => !declared.has(entry)))]).toEqual(
        [],
    )
})

// DECISIONS format rule 2 says "a check refuses an entry with none", and rule 4 says "a check
// refuses them here" of the requirement keywords. Neither check existed. The identical sentence in
// REGISTRY rule 3 and BRAND rule 2 IS backed, which is exactly why a reader believes these two —
// a gate that has never been shown to test anything is the one thing the discipline rules out.
test('every decision cites the clauses it decided', async () => {
    const decisions = await Bun.file(new URL('DECISIONS.md', DOCS)).text()
    const uncited: string[] = []
    for (const block of decisions.split(/^# (D\d+)\./m).slice(1)) {
        if (/^D\d+$/.test(block)) {
            uncited.push(block)
            continue
        }
        // The id was pushed by the split immediately before this block.
        if (/^\*\*Decides:\*\*/m.test(block)) uncited.pop()
    }
    expect(uncited).toEqual([])
})

test('no decision states a requirement', async () => {
    const decisions = await Bun.file(new URL('DECISIONS.md', DOCS)).text()
    const offenders: string[] = []
    for (const block of decisions.split(/^# (D\d+)\./m).slice(1)) {
        if (/^D\d+$/.test(block)) {
            offenders.push(block)
            continue
        }
        // Format rule 4 names the keywords; a clause QUOTED inside a withdrawal or a `Refused:`
        // line is the entry doing its job, so only unquoted prose counts.
        const prose = block.replace(/`[^`]*`/g, '').replace(/"[^"]*"/g, '')
        if (!REQUIREMENT.test(prose)) offenders.pop()
    }
    expect(offenders).toEqual([])
})

// DECISIONS format rule 5. EVERY OTHER CHECK HERE BUILDS A `Set` OF DECLARED IDS, and a duplicate
// collapses into one member of it — so `See D98` resolved, `D98` was cited, and both entries passed
// every gate while a reader following the citation landed on whichever came first. Three numbers
// shipped twice that way in one commit, the plans' entries having been appended without reading the
// counter, and what found it was a grep for something else.
test('no decision number is used twice', async () => {
    const decisions = await Bun.file(new URL('DECISIONS.md', DOCS)).text()
    const seen = new Set<string>()
    const twice: string[] = []
    for (const match of decisions.matchAll(/^# (D\d+)\./gm)) {
        const id = match[1] ?? ''
        if (seen.has(id)) twice.push(id)
        seen.add(id)
    }
    expect(twice).toEqual([])
})

// And the other way: a decision nobody reaches is a road not taken that no rule records taking.
test('every decision is cited by a clause', async () => {
    const decisions = await Bun.file(new URL('DECISIONS.md', DOCS)).text()
    const declared = [...decisions.matchAll(/^# (D\d+)\./gm)].map(
        (match) => match[1] ?? '',
    )
    // Whitespace-normalised: a citation wrapping across two lines is the same citation, and the
    // first version of this check read one as absent.
    const flat = rulebook.replace(/\s+/g, ' ')
    const cited = new Set(
        [...flat.matchAll(/\bSee (D\d+)\b/g)].map((match) => match[1] ?? ''),
    )
    expect(declared.filter((entry) => !cited.has(entry))).toEqual([])
})

// Format rule 7 promises that a withdrawn clause stays in place rather than vanishing, and until
// now nothing had ever been withdrawn, so the promise was untested. A withdrawal that does not name
// its successor is the failure it exists to prevent: an old citation resolving to a hole.
test('every withdrawn clause names the clause that supersedes it', async () => {
    const live = new Set(clauses().map((clause) => clause.id))
    const dangling: string[] = []
    for (const { id, text } of withdrawn()) {
        // A clause whose whole statement was answerable from a type is superseded by the REGISTRY
        // ROW that carries it rather than by another number — the statement changes document, and
        // there is no clause left to point at. So the row is what the withdrawal names, and it has
        // to resolve the same way a clause number does: five clauses moved this way, and a
        // withdrawal naming a row nobody wrote is the same hole as one naming no successor at all.
        const row = /superseded by REGISTRY's `([^`]+)` rows?\./.exec(text)?.[1]
        if (row) {
            if (!registry.includes(`| \`${row}\` |`)) dangling.push(id)
            continue
        }
        const successor = /superseded by (\d+\.\d+)/.exec(text)?.[1]
        if (!successor || !live.has(successor)) dangling.push(id)
    }
    expect(dangling).toEqual([])
})

// CLAUDE.md is the document every session reads first, and it named none of the other four while
// restating three of their rules — the by-name rule, the widening schema, and isomorphism, each
// written out in a second register with nothing comparing the two. It now cites instead, and a
// citation that stops resolving is the same silent staleness BRAND already had a check for.
test('every clause the working notes cite exists', async () => {
    const notes = await Bun.file(new URL('../CLAUDE.md', DOCS)).text()
    const ids = new Set(clauses().map((clause) => clause.id))
    const dangling: string[] = []
    for (const match of notes.matchAll(
        /RULEBOOK ((?:\d+\.\d+(?:,? (?:and )?)?)+)/g,
    )) {
        for (const id of (match[1] ?? '').matchAll(/\d+\.\d+/g)) {
            if (!ids.has(id[0])) dangling.push(id[0])
        }
    }
    expect(dangling.length === 0 && ids.size > 0).toBe(true)
    expect([...new Set(dangling)]).toEqual([])
})

// And the routing itself: a session told to read a document that is not there has been sent
// nowhere, which is exactly what happened to the sentence naming `SPEC.md`.
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
