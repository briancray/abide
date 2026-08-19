// What the real checker says about one file, from a program held OPEN.
//
// `checked.ts` beside this asks the same checker a question once and exits; this one is asked again
// on every keystroke, so the expensive half — loading a project, resolving its graph, building the
// program — has to happen once and be kept. That is the whole difference between the two files, and
// it is why this one is a loop rather than a `main`.
//
// It runs under NODE for the reason `checked.ts` states: TypeScript 7's checker is the native `tsgo`
// binary behind a synchronous RPC channel that reads `stdout._handle.fd`, a Node internal Bun does
// not expose, so under Bun the API throws on construction. The same limit follows from that — the
// file is TypeScript Node can STRIP rather than transform, so no parameter properties, no enums and
// no namespaces, which is also why the diagnostic categories below are written as numbers.
//
// It knows nothing about abide: it is handed a config and a path and hands back positions in that
// path. Which file to ask about, and what an offset in it means, is `live.ts`'s — so the mirror
// layout and the source map stay in one place and this cannot have an opinion that drifts from them.
//
// One JSON object per line each way. `{ tsconfig, file, changed }` in, `{ diagnostics }` or
// `{ error }` out, in the order asked.

import type { SourceFile } from 'typescript/unstable/ast'
import type { API, Checker, Diagnostic, Project, Snapshot } from 'typescript/unstable/sync'
// Relative and extensioned: this runs under Node with types STRIPPED, which resolves no alias.
import { identifierAt } from './identifierAt.ts'

interface Ask {
    tsconfig: string
    /** The module to report on — a path inside the project, not the `.abide` it was emitted from. */
    file: string
    /**
     * Absent means DIAGNOSTICS, which is the ask that existed before there were three and is the one
     * sent per keystroke. The other two are sent per hover and per click, so they are rarer and may
     * cost more.
     */
    kind?: 'type' | 'definition'
    /**
     * The identifier the cursor is on in the `.abide` FILE, when it is on one.
     *
     * Sent so this side can check the mapping landed on the same name. A body is mapped per LINE and
     * the emitter rewrites lines, so a column can point at real code that is somebody else's: the
     * setup's `props<T>()` becomes `args`, and a cursor on `props` mapped into `args;` and was
     * answered `any` — a type, for a callable that is not in the output at all.
     */
    name?: string
    /**
     * Where to ask, zero-based, in the WRITTEN module — banner included, since that is the file the
     * checker read. Lines rather than an offset for the reason `Reported` gives from the other
     * direction: the file is right here and its line map is the checker's own, so a caller that sent
     * an offset would be counting lines in a copy of text it could only assume still matched.
     */
    line?: number
    character?: number
}

/** One place a definition landed. The file is the CHECKER's path, which may be a generated module. */
interface Located {
    file: string
    line: number
    character: number
    endLine: number
    endCharacter: number
}

/**
 * `SymbolFlags.Alias`, spelled as its number.
 *
 * The enum is a real value export and could be imported — but this file is TypeScript Node STRIPS
 * rather than transforms, and the diagnostic categories above already made the same call for the same
 * reason. One convention per file beats one import saved.
 */
const ALIAS = 2097152

/**
 * A diagnostic reduced to what can cross a pipe.
 *
 * The positions are LINES, not offsets, and that is the whole reason this side converts them: the
 * checker reports an offset into bytes it read itself, and the source file it read is right here.
 * Answering in offsets instead made the other side keep a copy of every emitted module to count
 * lines in — a copy it could only assume was still the same text.
 */
interface Reported {
    /** Zero-based, in the WRITTEN module — banner included, since that is the file the checker read. */
    line: number
    character: number
    endLine: number
    endCharacter: number
    /** `0` warning, `1` error, `2` suggestion, `3` message — the checker's own numbering. */
    category: number
    /** The `TS2339` an editor shows beside the message, and `abide check` already prints. */
    code: number
    text: string
}

/**
 * A diagnostic's whole message, chain and all.
 *
 * The chain is where the useful half of a type error usually is — `text` on its own says two types
 * are not assignable and the link below it says which member disagreed. Joined with the indentation
 * an editor's hover already renders.
 */
function messageOf(diagnostic: Diagnostic, depth: number): string {
    const pad = '  '.repeat(depth)
    let text = pad + diagnostic.text
    for (const link of diagnostic.messageChain ?? []) text += `\n${messageOf(link, depth + 1)}`
    return text
}

/** `source` is the file the checker read, so its line map is the one the offsets are against. */
function reported(source: SourceFile, diagnostics: readonly Diagnostic[]): Reported[] {
    const out: Reported[] = []
    for (const diagnostic of diagnostics) {
        const start = source.getLineAndCharacterOfPosition(diagnostic.pos)
        const end = source.getLineAndCharacterOfPosition(diagnostic.end)
        out.push({
            line: start.line,
            character: start.character,
            endLine: end.line,
            endCharacter: end.character,
            category: diagnostic.category,
            code: diagnostic.code,
            text: messageOf(diagnostic, 0),
        })
    }
    return out
}

/**
 * Where the name under `position` was declared.
 *
 * The alias hop is the whole value of this for a `.abide` file: a component is written `<Card>` and
 * reached through an `import Card from './Card.abide'`, so the symbol at the cursor is the local
 * ALIAS and its only declaration is the import line three lines up. Following it is the difference
 * between landing on the import somebody is already looking at and landing on the component. An
 * alias that does not resolve answers with the checker's `unknown` symbol rather than throwing, so
 * the local one is kept and the author still gets the import.
 */
function definitions(project: Project, checker: Checker, file: string, position: number): Located[] {
    const found = checker.getSymbolAtPosition(file, position)
    if (found === undefined) return []
    let symbol = found
    if ((symbol.flags & ALIAS) !== 0) {
        const target = checker.getAliasedSymbol(symbol)
        if (!checker.isUnknownSymbol(target)) symbol = target
    }
    const out: Located[] = []
    for (const handle of symbol.declarations) {
        const node = handle.resolve(project)
        if (node === undefined) continue
        const declared = node.getSourceFile()
        // `getStart` and not `pos`: `pos` is the start of the node's TRIVIA, so a declaration with a
        // doc comment over it points at the blank line above the comment.
        const start = declared.getLineAndCharacterOfPosition(node.getStart(declared))
        const end = declared.getLineAndCharacterOfPosition(node.getEnd())
        out.push({
            file: declared.fileName,
            line: start.line,
            character: start.character,
            endLine: end.line,
            endCharacter: end.character,
        })
    }
    return out
}

async function main(): Promise<void> {
    const { API } = await import('typescript/unstable/sync')
    // One record rather than two `let`s: both are assigned inside the closure below and read after
    // the loop, which is exactly the flow a narrowed local reads as `never` at the bottom.
    const session: { api: API | null; held: Snapshot | null } = { api: null, held: null }

    const answer = (ask: Ask): string => {
        const api = session.api ?? new API({ cwd: process.cwd() })
        session.api = api
        // A NEW snapshot per ask, and the old one released after it: the project itself is
        // ref-counted and persists across snapshots, so this re-reads the one file named below and
        // keeps everything else — which is the whole reason this process stays alive. The file asked
        // about is the only one the caller can have rewritten, so it is the only one named.
        const snapshot = api.updateSnapshot({
            openProjects: [ask.tsconfig],
            fileChanges: { changed: [ask.file] },
        })
        session.held?.dispose()
        session.held = snapshot
        // BY NAME, not the first one: opens are ref-counted and persist, so a session that has been
        // asked about two packages holds two projects and `[0]` is whichever was opened first. The
        // `find` is the fallback for a config path the snapshot keyed under a normalised form.
        const project =
            snapshot.getProject(ask.tsconfig) ??
            snapshot.getProjects().find((one) => one.configFileName === ask.tsconfig)
        if (project === undefined) throw new Error(`abide: no project at ${ask.tsconfig}`)
        const { program } = project
        const source = program.getSourceFile(ask.file)
        if (source === undefined) throw new Error(`abide: ${ask.file} is not in ${ask.tsconfig}`)

        if (ask.kind === undefined) {
            // Syntactic FIRST and in one list: a file that does not parse has no meaningful semantic
            // diagnostics, and reporting the parse failure alongside a cascade of them is what makes
            // an emitted module look broken in twelve places when it is broken in one.
            const syntactic = program.getSyntacticDiagnostics(ask.file)
            const found = syntactic.length > 0 ? syntactic : program.getSemanticDiagnostics(ask.file)
            return JSON.stringify({ diagnostics: reported(source, found) })
        }

        // Clamped by the file the checker READ rather than trusted: the caller mapped this position
        // through a source map, and a mapping that came back past the end of a module — a buffer
        // edited between the emit and the ask — would otherwise throw where nothing is wrong.
        const position = Math.min(
            source.getPositionOfLineAndCharacter(ask.line ?? 0, ask.character ?? 0),
            source.text.length,
        )
        const { checker } = project

        // Two ways the mapping can land somewhere the author did not point at, and both answer
        // nothing rather than describing the emitter's own text.
        //
        // WHITESPACE: the rewrite left a shorter line, so the column falls in the gap. The checker
        // does not say so — asked about whitespace it answers for the enclosing node.
        //
        // A DIFFERENT NAME: the line was rewritten and the column landed on real code that is not
        // what the cursor was on. `const { depth = 0 } = props<{ depth?: number }>()` becomes
        // `const { depth: $depth } = args`, and `props` mapped into `args;` — answered `any`, for a
        // callable the output does not contain.
        const landed = identifierAt(source.text, position)
        const astray = ask.name !== undefined && landed !== undefined && landed !== ask.name
        if (astray || /\s/.test(source.text[position] ?? ' ')) {
            return JSON.stringify(ask.kind === 'type' ? { type: null, docs: null } : { definitions: [] })
        }

        if (ask.kind === 'type') {
            const type = checker.getTypeAtPosition(ask.file, position)
            // Through the ALIAS, the way `definitions` goes: every name a `.abide` file uses is
            // imported, so the symbol under the cursor is the local binding and its own doc comment
            // is the empty one nobody wrote. `state` hovered with no explanation for exactly this,
            // with a doc comment sitting on the declaration one module away.
            const found = checker.getSymbolAtPosition(ask.file, position)
            let symbol = found
            if (symbol !== undefined && (symbol.flags & ALIAS) !== 0) {
                const target = checker.getAliasedSymbol(symbol)
                if (!checker.isUnknownSymbol(target)) symbol = target
            }
            const documented = symbol === undefined ? '' : symbol.getDocumentationComment(checker)
            return JSON.stringify({
                type: type === undefined ? null : checker.typeToString(type),
                docs: documented === '' ? null : documented,
            })
        }

        return JSON.stringify({ definitions: definitions(project, checker, ask.file, position) })
    }

    let pending = ''
    process.stdin.setEncoding('utf8')
    for await (const chunk of process.stdin) {
        pending += chunk as string
        for (;;) {
            const line = pending.indexOf('\n')
            if (line === -1) break
            const text = pending.slice(0, line)
            pending = pending.slice(line + 1)
            if (text.trim() === '') continue
            let said: string
            try {
                said = answer(JSON.parse(text) as Ask)
            } catch (error) {
                said = JSON.stringify({ error: error instanceof Error ? error.message : String(error) })
            }
            process.stdout.write(`${said}\n`)
        }
    }
    session.held?.dispose()
    session.api?.close()
}

await main()
