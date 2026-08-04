// `abide lsp` — the `.abide` language server (spec C10.7, PR3). Runs UNDER NODE (the tsgo `API` can't
// open its pipe under Bun); `abide lsp` (Bun, from `main.ts`) is a dumb byte-pump forwarder to
// `node lsp.ts` (guarded by `bunCanHostTsgo()` so it flips to in-process the day Bun can host tsgo).
//
// Unlike the earlier stub (which re-ran `check(dir)` — whole-project, from disk, on open/save only),
// this is a PERSISTENT, buffer-aware server:
//   • a warm `LspEngine` keeps ONE tsgo `API` alive across requests (no per-keystroke cold start);
//   • unsaved editor buffers are lowered in-memory (`emitCheck`) and served through the `fs` overlay,
//     so `didChange` gives LIVE diagnostics before save (advertised sync: openClose + full change + save);
//   • it reuses the exact `emitCheck` / `componentDts` / overlay core as `abide check` — one checker.
//
// Diagnostics for OPEN documents (their errors, or empty to clear). The transport is injected
// (`read`/`write`) so the loop is drivable; the node entry at the bottom wires real stdio.

import { readFileSync, realpathSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
    type CallExpression,
    getTokenAtPosition,
    type Node,
    SyntaxKind,
} from 'typescript/unstable/ast'
import { API, SymbolFlags } from 'typescript/unstable/sync'
import { ABIDE_SEMANTIC_TOKENS_LEGEND } from '../ui/internal/ABIDE_SEMANTIC_TOKENS_LEGEND.ts'
import {
    type GeneratedIndex,
    indexByGeneratedPath,
    offsetToLineColumn,
    type RawDiagnostic,
    resolveAbidePosition,
    resolveAbideRange,
} from '../ui/internal/abideDiagnostic.ts'
import { mapOrigToGen } from '../ui/internal/emitCheck.ts'
import { encodeSemanticTokens } from '../ui/internal/encodeSemanticTokens.ts'
import {
    type LoweredModule,
    lowerProject as sharedLowerProject,
} from '../ui/internal/lowerProject.ts'
import { templateSemanticTokens } from '../ui/internal/templateSemanticTokens.ts'
import { collectDiagnostics, findAbideFiles, overlayFs } from './check.ts'
import { lspCapabilities } from './LSP_FEATURES.ts'
import { writeHealthCompanion } from './writeHealthCompanion.ts'

export interface LspServerOptions {
    projectRoot: string
    read: ReadableStream<Uint8Array>
    write: (bytes: Uint8Array) => void
}

// Debounce window for recomputing diagnostics after an edit. Diagnostics lower the whole project + build
// a fresh tsgo program (~100s of ms), so running them inline on every keystroke saturates the single-
// threaded server loop and makes interactive requests (semanticTokens, hover) time out. Coalescing to
// one run after typing settles keeps the loop responsive.
const REFRESH_DEBOUNCE_MS = 250

interface JsonRpcMessage {
    id?: number | string
    method?: string
    params?: unknown
}

interface LspDiagnostic {
    range: { start: { line: number; character: number }; end: { line: number; character: number } }
    severity: number
    code: number
    source: string
    message: string
}

// A generated check-module for one script-bearing `.abide` (its virtual `.ts` path + the map back).
// The shared lowering's own record — `abide check` reads exactly the same one.
type CheckModule = LoweredModule

// ONE POSITION, EVERYTHING THE FIVE HANDLERS CAN ASK ABOUT IT.
//
// A `.abide` position resolves to a generated-module offset, and each LSP feature then asks the checker
// one question at that offset. The four values every question needs (the lowered overlay, the open set,
// the generated file, the offset) are the SAME four for all five, so the handlers took them as a record
// and spelled the call each time — which is also how two of them came to rebuild the generated-module
// index by hand instead of using the one this carries.
interface PositionQuery {
    module: CheckModule
    // Built by `indexByGeneratedPath` — the only producer of the branded type `declToLocation` accepts.
    index: GeneratedIndex<CheckModule>
    type(): { type: string; documentation: string; start: number; end: number } | null
    definitions(): Array<{ file: string; pos: number; end: number }>
    references(): Array<{ file: string; pos: number; end: number }>
    completions(): ReturnType<LspEngine['completionsAt']>
    signature(): {
        label: string
        parameters: Array<{ label: string }>
        activeParameter: number
    } | null
}

interface ParseError {
    line: number
    column: number
    message: string
}

interface LoweredProject {
    files: Record<string, string>
    modules: CheckModule[]
    parseErrors: Map<string, ParseError>
}

// ---------------------------------------------------------------------------
// Lowering (node-side, buffer-aware — mirrors `check`'s in-memory overlay build)
// ---------------------------------------------------------------------------

// 0-based LSP (line, character) → absolute offset in `source`.
function lineColumnToOffset(source: string, line: number, character: number): number {
    let offset = 0
    let currentLine = 0
    while (currentLine < line && offset < source.length) {
        if (source.charCodeAt(offset) === 10) currentLine++
        offset++
    }
    return Math.min(offset + character, source.length)
}

// Lower every `.abide` under `dir` into virtual files (generated modules + `.d.ts` companions) served
// through the overlay. `overrides` supplies unsaved buffer content (keyed by absolute path) in place of
// the disk file — the source of LIVE diagnostics. Virtual paths are STABLE (one per `.abide`, no
// revision) so an unchanged buffer lowers to a byte-identical overlay — the engine keys its warm-API
// reuse on that. Freshness comes from the engine recreating the API when the overlay changes, NOT from
// churning paths (see `LspEngine.snapshot`).
// The shared lowering (`ui/internal/lowerProject.ts`), with the LSP's two differences supplied as
// parameters: a reader that serves UNSAVED editor buffers ahead of disk — which is the whole point of
// a language server, and the reason this cannot simply call `abide check` — and its own virtual path
// scheme. `abide check` supplies a Bun reader and a content-hashed path against the same loop, so the
// editor and CI cannot disagree about what a project's types are.
function lowerCurrentProject(dir: string, overrides: Record<string, string>): LoweredProject {
    const lowered = sharedLowerProject({
        abideFiles: findAbideFiles(dir),
        readSource: (abidePath) => {
            const override = overrides[abidePath]
            if (override !== undefined) return override
            try {
                return readFileSync(abidePath, 'utf8')
            } catch {
                return undefined
            }
        },
        tsPathFor: (abidePath) =>
            join(
                dirname(abidePath),
                `__abide_lsp_${basename(abidePath).replace(/[^\w]/g, '_')}.ts`,
            ),
    })
    const parseErrors = new Map<string, ParseError>()
    for (const failure of lowered.failures) {
        // A build-lane rejection is reported through the same channel as a parse error, so the editor
        // shows what `abide build` would reject rather than going green on an unbuildable template.
        parseErrors.set(failure.abidePath, {
            line: failure.line,
            column: failure.column,
            message: failure.message,
        })
    }
    return { files: lowered.files, modules: lowered.modules, parseErrors }
}

// ---------------------------------------------------------------------------
// Persistent engine — one warm tsgo `API` + a live `fs` overlay across requests
// ---------------------------------------------------------------------------

class LspEngine {
    private readonly cwd: string
    private api: API | null = null
    private files: Record<string, string> = {}
    private signature = '' // content-hash of the last overlay + open set the current API was built on
    private lastSnapshot: ReturnType<API['updateSnapshot']> | null = null

    constructor(cwd: string) {
        this.cwd = cwd
    }

    // Return a snapshot for `files`/`open`, building a FRESH tsgo `API` whenever the overlay or open set
    // changed since the last call, and reusing the warm one when nothing changed. This is deliberate: a
    // warm API's incremental `updateSnapshot` collapses CROSS-FILE import resolution to `any` after its
    // first snapshot (a tsgo incremental-resolution defect — a file's own checks stay correct across
    // snapshots, which is why plain diagnostics looked fine but every `$server/rpc/*` hover was `any`);
    // a first snapshot on a fresh API always resolves. Reuse keeps hover/completion bursts on an
    // unchanged buffer warm (the common case); only an actual edit pays the rebuild.
    private snapshot(files: Record<string, string>, open: string[]) {
        const signature = overlaySignature(files, open)
        if (this.api !== null && this.lastSnapshot !== null && signature === this.signature)
            return this.lastSnapshot
        this.api?.close()
        this.files = files
        this.api = new API({ cwd: this.cwd, fs: overlayFs(() => this.files) })
        this.signature = signature
        this.lastSnapshot = this.api.updateSnapshot({ openFiles: open, closeFiles: [] })
        return this.lastSnapshot
    }

    // Diagnostics for the `open` generated modules. The COLLECTION rule is `check.ts`'s (this server
    // already borrows `SUPPRESSED_CODES` and `overlayFs` from there); what this half contributes is the
    // WARM snapshot, which is the only thing that differs between the two callers.
    diagnose(files: Record<string, string>, open: string[]): RawDiagnostic[] {
        return collectDiagnostics(this.snapshot(files, open), open)
    }

    // Hover: the type string (+ any doc comment) at a generated-module position, plus the hovered
    // token's generated span (`start`/`end`) so the caller can report a precise hover `range` — without
    // it the editor highlights the whole enclosing text node (the entire `{…}` interpolation). Null when
    // the position resolves to nothing (e.g. inside synthetic scaffolding).
    typeAt(
        files: Record<string, string>,
        open: string[],
        file: string,
        position: number,
    ): { type: string; documentation: string; start: number; end: number } | null {
        const snapshot = this.snapshot(files, open)
        const project = snapshot.getDefaultProjectForFile(file)
        if (project === undefined) return null
        const type = project.checker.getTypeAtPosition(file, position)
        if (type === undefined) return null
        const symbol = project.checker.getSymbolAtPosition(file, position)
        const sourceFile = project.program.getSourceFile(file)
        const token =
            sourceFile !== undefined ? getTokenAtPosition(sourceFile, position) : undefined
        return {
            type: project.checker.typeToString(type),
            documentation:
                symbol !== undefined ? symbol.getDocumentationComment(project.checker) : '',
            start: token !== undefined ? token.getStart() : position,
            end: token !== undefined ? token.getEnd() : position,
        }
    }

    // Go-to-definition: the declaration site(s) of the symbol at a generated-module position, as
    // `{ file, pos, end }` in whatever file each declaration lives (a virtual generated module, a
    // `.abide.d.ts` companion, or a real `.ts`). The caller maps virtual files back to `.abide`.
    definitionAt(
        files: Record<string, string>,
        open: string[],
        file: string,
        position: number,
    ): Array<{ file: string; pos: number; end: number }> {
        const snapshot = this.snapshot(files, open)
        const project = snapshot.getDefaultProjectForFile(file)
        if (project === undefined) return []
        const symbol = project.checker.getSymbolAtPosition(file, position)
        if (symbol === undefined) return []
        // Follow an import alias through to the real symbol, so go-to-definition jumps to the SOURCE
        // (e.g. `$server/rpc/capabilities.ts`) instead of landing on the local `import …` line in the
        // `.abide`. Non-alias symbols (locals) are used as-is.
        let target = symbol
        if ((symbol.flags & SymbolFlags.Alias) !== 0) {
            const aliased = project.checker.getAliasedSymbol(symbol)
            if (!project.checker.isUnknownSymbol(aliased) && aliased.declarations.length > 0)
                target = aliased
        }
        const locations: Array<{ file: string; pos: number; end: number }> = []
        for (const handle of target.declarations) {
            const node = handle.resolve(project)
            if (node === undefined) continue
            locations.push({ file: String(handle.path), pos: node.getStart(), end: node.getEnd() })
        }
        return locations
    }

    // Completion: the entries at a generated-module position, mapped toward LSP `CompletionItem`s. tsgo's
    // `CompletionItemKind` is already the LSP enum (it speaks LSP natively), so `kind` passes through.
    completionsAt(
        files: Record<string, string>,
        open: string[],
        file: string,
        position: number,
    ): Array<{
        label: string
        kind: number | undefined
        detail: string | undefined
        insertText: string | undefined
        sortText: string | undefined
    }> {
        const snapshot = this.snapshot(files, open)
        const project = snapshot.getDefaultProjectForFile(file)
        if (project === undefined) return []
        // tsgo THROWS `completion list needs auto imports` at a position whose completion list would
        // need auto-import entries, and its `CompletionOptions` (`triggerCharacter`/`includeSymbol`)
        // has no way to ask for them or to decline them. So the error is not a bug to fix here, it is
        // a capability this API cannot express yet — degrade to the entries we can serve rather than
        // failing the request. Kept narrow: anything else rethrows to the handler boundary, which
        // answers it as a JSON-RPC error.
        let info: ReturnType<typeof project.checker.getCompletionsAtPosition>
        try {
            info = project.checker.getCompletionsAtPosition(file, position)
        } catch (caught) {
            if (!(caught instanceof Error) || !caught.message.includes('auto imports')) throw caught
            return []
        }
        if (info === undefined) return []
        // `undefined` fields are dropped by JSON.stringify, so the wire `CompletionItem`s stay clean.
        return info.entries.map((entry) => ({
            label: entry.name,
            kind: entry.kind as number | undefined,
            detail: entry.detail ?? entry.labelDetails?.detail,
            insertText: entry.insertText,
            sortText: entry.sortText,
        }))
    }

    // Signature help: walk up from the token at `position` to the enclosing call, resolve its signature,
    // and format its parameters + the active parameter (args ended before the cursor). Null when the
    // position is not inside a call.
    signatureAt(
        files: Record<string, string>,
        open: string[],
        file: string,
        position: number,
    ): { label: string; parameters: Array<{ label: string }>; activeParameter: number } | null {
        const snapshot = this.snapshot(files, open)
        const project = snapshot.getDefaultProjectForFile(file)
        if (project === undefined) return null
        const sourceFile = project.program.getSourceFile(file)
        if (sourceFile === undefined) return null
        let node: Node | undefined = getTokenAtPosition(sourceFile, position)
        while (node !== undefined && node.kind !== SyntaxKind.CallExpression)
            node = node.parent as Node | undefined
        if (node === undefined) return null
        const call = node as CallExpression
        const signature = project.checker.getResolvedSignature(call)
        if (signature === undefined) return null
        const checker = project.checker
        const parameters = signature.getParameters().map((symbol) => {
            const type = checker.getTypeOfSymbol(symbol)
            return {
                label: `${symbol.name}: ${type !== undefined ? checker.typeToString(type) : 'any'}`,
            }
        })
        const returnType = checker.getReturnTypeOfSignature(signature)
        const label = `(${parameters.map((p) => p.label).join(', ')})${returnType !== undefined ? `: ${checker.typeToString(returnType)}` : ''}`
        let activeParameter = 0
        for (const argument of call.arguments) {
            if (position > argument.getEnd()) activeParameter++
            else break
        }
        return { label, parameters, activeParameter }
    }

    // Find-references: every reference NodeHandle of the symbol at a position, as `{ file, pos, end }`
    // (the caller maps each back the same way as a definition). Searches the loaded (open) modules + real
    // files; references in CLOSED `.abide` modules aren't loaded (a v1 limit, like open-doc diagnostics).
    referencesAt(
        files: Record<string, string>,
        open: string[],
        file: string,
        position: number,
    ): Array<{ file: string; pos: number; end: number }> {
        const snapshot = this.snapshot(files, open)
        const project = snapshot.getDefaultProjectForFile(file)
        if (project === undefined) return []
        const sourceFile = project.program.getSourceFile(file)
        if (sourceFile === undefined) return []
        const node = getTokenAtPosition(sourceFile, position)
        const locations: Array<{ file: string; pos: number; end: number }> = []
        for (const entry of project.checker.getReferencedSymbolsForNode(node, position)) {
            for (const handle of entry.references) {
                const referenceNode = handle.resolve(project)
                if (referenceNode === undefined) continue
                locations.push({
                    file: String(handle.path),
                    pos: referenceNode.getStart(),
                    end: referenceNode.getEnd(),
                })
            }
        }
        return locations
    }

    close(): void {
        this.api?.close()
    }
}

// A cheap deterministic signature of the overlay + open set — the engine reuses its warm API only while
// this is unchanged. FNV-1a over each `path\0content` and the open list catches any content or file-set
// change (edits, added/removed `.abide`, a different open doc); an unchanged buffer hashes identically.
function overlaySignature(files: Record<string, string>, open: string[]): string {
    let hash = 0x811c9dc5
    const mix = (text: string): void => {
        for (let index = 0; index < text.length; index++) {
            hash ^= text.charCodeAt(index)
            hash = Math.imul(hash, 0x01000193)
        }
        hash = Math.imul(hash, 0x01000193)
    }
    for (const path of Object.keys(files).sort()) {
        mix(path)
        mix(files[path] ?? '')
    }
    mix('\u0001')
    for (const path of open) mix(path)
    return (hash >>> 0).toString(16)
}

// ---------------------------------------------------------------------------
// Transport + server loop
// ---------------------------------------------------------------------------

function toLspDiagnostic(
    line: number,
    column: number,
    code: number,
    message: string,
): LspDiagnostic {
    const l = Math.max(0, line - 1)
    const c = Math.max(0, column - 1)
    return {
        range: { start: { line: l, character: c }, end: { line: l, character: c + 1 } },
        severity: 1,
        code,
        source: 'abide',
        message,
    }
}

function headerTerminator(buffer: Uint8Array): number {
    for (let i = 0; i + 3 < buffer.length; i++) {
        if (
            buffer[i] === 13 &&
            buffer[i + 1] === 10 &&
            buffer[i + 2] === 13 &&
            buffer[i + 3] === 10
        )
            return i
    }
    return -1
}

export async function lspServer(options: LspServerOptions): Promise<void> {
    let projectRoot = options.projectRoot
    let engine: LspEngine | null = null
    const buffers = new Map<string, string>() // abidePath -> unsaved content
    const openDocs = new Set<string>() // abidePaths currently open
    const encoder = new TextEncoder()
    const decoder = new TextDecoder()

    const send = (message: object): void => {
        const body = encoder.encode(JSON.stringify(message))
        const header = encoder.encode(`Content-Length: ${body.length}\r\n\r\n`)
        const frame = new Uint8Array(header.length + body.length)
        frame.set(header, 0)
        frame.set(body, header.length)
        options.write(frame)
    }
    const publish = (abidePath: string, diagnostics: LspDiagnostic[]): void => {
        send({
            jsonrpc: '2.0',
            method: 'textDocument/publishDiagnostics',
            params: { uri: pathToFileURL(abidePath).href, diagnostics },
        })
    }

    const lowerCurrent = (): LoweredProject => {
        const overrides: Record<string, string> = {}
        for (const [path, content] of buffers) overrides[path] = content
        return lowerCurrentProject(projectRoot, overrides)
    }

    const refresh = (): void => {
        if (engine === null || openDocs.size === 0) return
        const { files, modules, parseErrors } = lowerCurrent()
        // Indexing + map-back is `abideDiagnostic`, shared with `abide check` (see the note there on the
        // two silent drops it owns). `byTs` stays in scope below for the hover/definition paths, which
        // look modules up by the same canonicalized key.
        const byTs = indexByGeneratedPath(modules)
        const openModulePaths = modules
            .filter((m) => openDocs.has(m.abidePath))
            .map((m) => m.tsPath)
        const raw = openModulePaths.length > 0 ? engine.diagnose(files, openModulePaths) : []
        const byFile = new Map<string, LspDiagnostic[]>()
        for (const diagnostic of raw) {
            const resolved = resolveAbidePosition(diagnostic, byTs)
            if (resolved === undefined) continue
            const list = byFile.get(resolved.module.abidePath) ?? []
            list.push(
                toLspDiagnostic(resolved.line, resolved.column, diagnostic.code, diagnostic.text),
            )
            byFile.set(resolved.module.abidePath, list)
        }
        // Publish for every OPEN doc (its errors, a parse error, or empty to clear stale squiggles).
        for (const abidePath of openDocs) {
            const parseError = parseErrors.get(abidePath)
            if (parseError !== undefined)
                publish(abidePath, [
                    toLspDiagnostic(parseError.line, parseError.column, 0, parseError.message),
                ])
            else publish(abidePath, byFile.get(abidePath) ?? [])
        }
    }

    // Coalesce diagnostics: each edit re-arms the timer, so `refresh` runs once after typing settles
    // instead of blocking the loop on every keystroke. The timer fires while the loop awaits input.
    let refreshTimer: ReturnType<typeof setTimeout> | null = null
    const scheduleRefresh = (): void => {
        if (refreshTimer !== null) clearTimeout(refreshTimer)
        refreshTimer = setTimeout(() => {
            refreshTimer = null
            refresh()
        }, REFRESH_DEBOUNCE_MS)
    }

    const documentPath = (params: unknown): string | undefined => {
        const uri = (params as { textDocument?: { uri?: string } } | undefined)?.textDocument?.uri
        return uri === undefined ? undefined : fileURLToPath(uri)
    }

    // Lower the project with current buffers and map a request's `.abide` (line, character) to the
    // generated-module offset it corresponds to, as a QUERY over that position. Null when off an open doc
    // or on a non-mapped (synthetic) span.
    //
    // The five position handlers used to take a data record and each spell the same ritual: re-check
    // `engine !== null` (already checked here, repeated only because tsc cannot narrow a closure) and pass
    // `target.files, target.open, target.module.tsPath, target.gen` verbatim. Two of them ALSO rebuilt the
    // generated-module index inline, which is the drift `abideDiagnostic`'s brand now makes
    // unrepresentable — it is built here, once, by the one function allowed to.
    const resolvePosition = (params: unknown): PositionQuery | null => {
        if (engine === null) return null
        const path = documentPath(params)
        const position = (params as { position?: { line: number; character: number } } | undefined)
            ?.position
        if (path === undefined || position === undefined || !openDocs.has(path)) return null
        const { files, modules } = lowerCurrent()
        const module = modules.find((m) => m.abidePath === path)
        if (module === undefined) return null
        const offset = lineColumnToOffset(module.source, position.line, position.character)
        let gen = mapOrigToGen(module.segments, offset)
        if (gen === -1 && offset > 0) {
            // Cursor at a segment boundary (e.g. right after `.` in `count.`): map the preceding char and step
            // one past it, so completion queries the position just after the mapped text.
            const previous = mapOrigToGen(module.segments, offset - 1)
            gen = previous === -1 ? -1 : previous + 1
        }
        if (gen === -1) return null
        const open = modules.filter((m) => openDocs.has(m.abidePath)).map((m) => m.tsPath)
        const at = engine
        const file = module.tsPath
        return {
            module,
            index: indexByGeneratedPath(modules),
            type: () => at.typeAt(files, open, file, gen),
            definitions: () => at.definitionAt(files, open, file, gen),
            references: () => at.referencesAt(files, open, file, gen),
            completions: () => at.completionsAt(files, open, file, gen),
            signature: () => at.signatureAt(files, open, file, gen),
        }
    }

    const makeLocation = (
        file: string,
        source: string,
        startOffset: number,
        endOffset: number,
    ): object => {
        const start = offsetToLineColumn(source, startOffset)
        const end = offsetToLineColumn(source, endOffset)
        return {
            uri: pathToFileURL(file).href,
            range: {
                start: { line: start.line - 1, character: start.column - 1 },
                end: { line: end.line - 1, character: end.column - 1 },
            },
        }
    }

    // Recover a path's real on-disk case. tsgo canonicalizes `handle.path` to lowercase on a
    // case-insensitive filesystem, so a location built from it (`…/demo.abide`) opens a phantom
    // lowercased buffer in the editor that the language server never attaches to. `realpathSync.native`
    // returns the actual stored casing (`…/Demo.abide`); falls back to the input if the file is absent.
    const realCasePath = (path: string): string => {
        try {
            const real = realpathSync.native(path)
            // Only accept a pure CASE correction — `realpathSync` also resolves symlinks (e.g. macOS
            // `/var` → `/private/var`), which would rewrite an otherwise-correct path.
            return real.toLowerCase() === path.toLowerCase() ? real : path
        } catch {
            return path
        }
    }

    // Map a declaration site to an LSP Location: a virtual generated module → back to its `.abide` (via
    // segments); a `.abide.d.ts` companion (synthetic) → the top of the `.abide`; a real `.ts` → as-is.
    // `byTs` is keyed lowercase — tsgo canonicalizes `handle.path` on a case-insensitive filesystem.
    const declToLocation = (
        decl: { file: string; pos: number; end: number },
        byTs: GeneratedIndex<CheckModule>,
    ): object | null => {
        const module = byTs.get(decl.file.toLowerCase())
        if (module !== undefined) {
            // Through the shared range map-back: this used to map `decl.end` RAW, and a generated end
            // offset lands on a half-open segment boundary, so it snapped forward to an unrelated later
            // token. Hover had the correction; the path backing go-to-definition and find-references
            // did not.
            const span = resolveAbideRange(module, decl.pos, decl.end)
            if (span === undefined) return null
            return makeLocation(module.abidePath, module.source, span.start, span.end)
        }
        if (decl.file.endsWith('.abide.d.ts')) {
            return {
                uri: pathToFileURL(realCasePath(decl.file.slice(0, -'.d.ts'.length))).href,
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
            }
        }
        const file = realCasePath(decl.file)
        let source: string
        try {
            source = readFileSync(file, 'utf8')
        } catch {
            return null
        }
        return makeLocation(file, source, decl.pos, decl.end)
    }

    const dispatch = (message: JsonRpcMessage): boolean => {
        switch (message.method) {
            case 'initialize': {
                const params = message.params as
                    | { rootUri?: string | null; rootPath?: string }
                    | undefined
                if (params?.rootUri) projectRoot = fileURLToPath(params.rootUri)
                else if (params?.rootPath) projectRoot = params.rootPath
                // An editor opening the project cold is the one moment we know the root — and the
                // health companion (CO2.4) is gitignored, so on a fresh clone it does not exist yet.
                // Not awaited: `initialize` must answer immediately, and the engine reads the file
                // system per request, so a companion landing a tick later is a companion in time.
                void writeHealthCompanion(projectRoot).catch(() => {})
                engine = new LspEngine(projectRoot)
                send({
                    jsonrpc: '2.0',
                    id: message.id,
                    // Derived from `LSP_FEATURES`, so a feature cannot be advertised without a
                    // handler or handled without being advertised.
                    result: {
                        capabilities: lspCapabilities({
                            semanticTokensProvider: {
                                legend: ABIDE_SEMANTIC_TOKENS_LEGEND,
                                full: true,
                            },
                        }),
                    },
                })
                return false
            }
            case 'initialized':
                return false
            case 'textDocument/didOpen': {
                const path = documentPath(message.params)
                const text = (message.params as { textDocument?: { text?: string } } | undefined)
                    ?.textDocument?.text
                if (path !== undefined && text !== undefined) {
                    buffers.set(path, text)
                    openDocs.add(path)
                    scheduleRefresh()
                }
                return false
            }
            case 'textDocument/didChange': {
                const path = documentPath(message.params)
                const changes = (
                    message.params as { contentChanges?: Array<{ text?: string }> } | undefined
                )?.contentChanges
                const lastChange = changes !== undefined ? changes.at(-1) : undefined
                const text = lastChange !== undefined ? lastChange.text : undefined
                if (path !== undefined && text !== undefined) {
                    buffers.set(path, text)
                    scheduleRefresh()
                }
                return false
            }
            case 'textDocument/didSave': {
                const path = documentPath(message.params)
                if (path !== undefined) scheduleRefresh()
                return false
            }
            case 'textDocument/didClose': {
                const path = documentPath(message.params)
                if (path !== undefined) {
                    buffers.delete(path)
                    openDocs.delete(path)
                    publish(path, []) // clear on close
                }
                return false
            }
            case 'textDocument/hover': {
                const target = resolvePosition(message.params)
                let result: object | null = null
                if (target !== null) {
                    const info = target.type()
                    if (info !== null) {
                        const value = `\`\`\`typescript\n${info.type}\n\`\`\`${info.documentation ? `\n\n${info.documentation}` : ''}`
                        // Map the hovered token's generated span back to the `.abide` so the editor
                        // highlights just that token (e.g. `blurb` in `{cap.blurb}`), not the whole
                        // interpolation. Omit the range on a synthetic/unmapped token.
                        const span = resolveAbideRange(target.module, info.start, info.end)
                        let range: object | undefined
                        if (span !== undefined) {
                            const start = offsetToLineColumn(target.module.source, span.start)
                            const end = offsetToLineColumn(target.module.source, span.end)
                            range = {
                                start: { line: start.line - 1, character: start.column - 1 },
                                end: { line: end.line - 1, character: end.column - 1 },
                            }
                        }
                        result = {
                            contents: { kind: 'markdown', value },
                            ...(range ? { range } : {}),
                        }
                    }
                }
                send({ jsonrpc: '2.0', id: message.id, result })
                return false
            }
            case 'textDocument/definition': {
                const target = resolvePosition(message.params)
                let result: object[] | null = null
                if (target !== null) {
                    const locations: object[] = []
                    for (const decl of target.definitions()) {
                        const location = declToLocation(decl, target.index)
                        if (location !== null) locations.push(location)
                    }
                    if (locations.length > 0) result = locations
                }
                send({ jsonrpc: '2.0', id: message.id, result })
                return false
            }
            case 'textDocument/completion': {
                const target = resolvePosition(message.params)
                let result: object | null = null
                if (target !== null) {
                    result = { isIncomplete: false, items: target.completions() }
                }
                send({ jsonrpc: '2.0', id: message.id, result })
                return false
            }
            case 'textDocument/signatureHelp': {
                const target = resolvePosition(message.params)
                let result: object | null = null
                if (target !== null) {
                    const info = target.signature()
                    if (info !== null)
                        result = {
                            signatures: [{ label: info.label, parameters: info.parameters }],
                            activeSignature: 0,
                            activeParameter: info.activeParameter,
                        }
                }
                send({ jsonrpc: '2.0', id: message.id, result })
                return false
            }
            case 'textDocument/references': {
                const target = resolvePosition(message.params)
                const result: object[] = []
                if (target !== null) {
                    for (const reference of target.references()) {
                        const location = declToLocation(reference, target.index)
                        if (location !== null) result.push(location)
                    }
                }
                send({ jsonrpc: '2.0', id: message.id, result })
                return false
            }
            case 'textDocument/semanticTokens/full': {
                // Markup + block-framing tokens from the raw `.abide` (the ONE parse walk), NOT the
                // lowered TS shadow — expression interiors and script/style bodies are left to the
                // grammar/injection layer. Prefer the unsaved buffer; fall back to disk.
                const path = documentPath(message.params)
                let data: number[] = []
                if (path !== undefined) {
                    let source = buffers.get(path)
                    if (source === undefined) {
                        try {
                            source = readFileSync(path, 'utf8')
                        } catch {
                            source = undefined
                        }
                    }
                    if (source !== undefined)
                        data = encodeSemanticTokens(source, templateSemanticTokens(source))
                }
                send({ jsonrpc: '2.0', id: message.id, result: { data } })
                return false
            }
            case 'shutdown':
                send({ jsonrpc: '2.0', id: message.id, result: null })
                return false
            case 'exit':
                if (refreshTimer !== null) clearTimeout(refreshTimer)
                engine?.close()
                return true
            default:
                if (message.id !== undefined)
                    send({
                        jsonrpc: '2.0',
                        id: message.id,
                        error: { code: -32601, message: `Unhandled method: ${message.method}` },
                    })
                return false
        }
    }

    // A HANDLER'S THROW MUST NOT KILL THE SERVER.
    //
    // It did. `dispatch` was called straight from the read loop, so anything it threw propagated out of
    // `lspServer` and ended the process — and a real one was reachable: tsgo raises
    // `completion list needs auto imports` from `getCompletionsAtPosition`, so typing `.` at the wrong
    // position took down the whole language server. Not the completion request — the SERVER: every
    // later request went unanswered because there was nothing left to answer them, and the editor lost
    // diagnostics, hover and go-to-definition until it restarted the sidecar.
    //
    // A request gets a JSON-RPC error so the client stops waiting (an LSP client with no timeout waits
    // forever on a request that never answers); a notification has no id to answer, so it is dropped
    // after a note on stderr. Either way the loop continues, which is the whole point: one bad position
    // in one file is not a reason to stop serving the other twenty.
    const handle = (message: JsonRpcMessage): boolean => {
        try {
            return dispatch(message)
        } catch (caught) {
            const detail = caught instanceof Error ? caught.message : String(caught)
            if (message.id !== undefined) {
                send({
                    jsonrpc: '2.0',
                    id: message.id,
                    error: { code: -32603, message: `${message.method} failed: ${detail}` },
                })
            } else {
                process.stderr.write(`abide lsp: ${message.method} failed: ${detail}\n`)
            }
            return false
        }
    }

    const reader = options.read.getReader()
    let buffer = new Uint8Array(0)
    for (;;) {
        const terminator = headerTerminator(buffer)
        if (terminator !== -1) {
            const header = decoder.decode(buffer.subarray(0, terminator))
            const match = /Content-Length:\s*(\d+)/i.exec(header)
            const bodyStart = terminator + 4
            if (match === null) {
                buffer = buffer.slice(bodyStart)
                continue
            }
            const length = Number(match[1])
            if (buffer.length >= bodyStart + length) {
                const body = decoder.decode(buffer.subarray(bodyStart, bodyStart + length))
                buffer = buffer.slice(bodyStart + length)
                let message: JsonRpcMessage | undefined
                try {
                    message = JSON.parse(body) as JsonRpcMessage
                } catch {
                    message = undefined
                }
                if (message !== undefined && handle(message)) break
                continue
            }
        }
        const chunk = await reader.read()
        if (chunk.done) break
        const merged = new Uint8Array(buffer.length + chunk.value.length)
        merged.set(buffer, 0)
        merged.set(chunk.value, buffer.length)
        buffer = merged
    }
    reader.releaseLock()
}

// node entry: `node lsp.ts` (the process `abide lsp` forwards to). Wires real stdio.
//
// The writes are COUNTED and drained before the process is allowed to end. `process.stdout` to a PIPE
// is asynchronous in node, and `send` is fire-and-forget, so when `exit` broke the read loop the
// process ended with frames still sitting in the kernel buffer — silently DROPPING replies that had
// already been produced. It looked like "the last few requests were never handled", which is a very
// different bug from the one it was.
//
// It needs a burst to show: two requests answered and six did not, because the earlier writes had
// already flushed. That is why it survived — every existing test sends at most two requests, and an
// editor sends them one at a time with think-time in between. A batch driver (the capability-parity
// test, `packages/docs/scripts/lsp-dogfood.ts`) writes every frame at once and loses most of the
// replies.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const read = Readable.toWeb(process.stdin) as unknown as ReadableStream<Uint8Array>
    let pending = 0
    let onDrained: (() => void) | null = null
    const write = (bytes: Uint8Array): void => {
        pending++
        process.stdout.write(bytes, () => {
            pending--
            if (pending === 0 && onDrained !== null) onDrained()
        })
    }
    await lspServer({ projectRoot: process.cwd(), read, write })
    if (pending > 0) await new Promise<void>((resolve) => (onDrained = resolve))
}
