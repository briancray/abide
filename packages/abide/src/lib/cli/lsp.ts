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

import { API, DiagnosticCategory } from "typescript/unstable/sync";
import { SyntaxKind, getTokenAtPosition, type Node, type CallExpression } from "typescript/unstable/ast";
import { readdirSync, readFileSync, type Dirent } from "node:fs";
import { join, dirname, basename } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import type { Root } from "../ui/internal/ast.ts";
import { parse } from "../ui/internal/parse.ts";
import { emitCheck, componentDts, mapGenToOrig, mapOrigToGen, CHECK_HEADER_LENGTH, type Segment } from "../ui/internal/emitCheck.ts";
import { overlayFs, CHECK_SUPPRESSED_CODES } from "./check.ts";

export interface LspServerOptions {
  projectRoot: string;
  read: ReadableStream<Uint8Array>;
  write: (bytes: Uint8Array) => void;
}

interface JsonRpcMessage {
  id?: number | string;
  method?: string;
  params?: unknown;
}

interface LspDiagnostic {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  severity: number;
  code: number;
  source: string;
  message: string;
}

interface RawDiagnostic {
  file: string;
  pos: number;
  code: number;
  text: string;
}

// A generated check-module for one script-bearing `.abide` (its virtual `.ts` path + the map back).
interface CheckModule {
  abidePath: string;
  tsPath: string;
  source: string;
  segments: Segment[];
}

interface ParseError {
  line: number;
  column: number;
  message: string;
}

interface LoweredProject {
  files: Record<string, string>;
  modules: CheckModule[];
  parseErrors: Map<string, ParseError>;
}

// ---------------------------------------------------------------------------
// Lowering (node-side, buffer-aware — mirrors `check`'s in-memory overlay build)
// ---------------------------------------------------------------------------

function findAbideFiles(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const dirent of entries) {
      const full = join(current, dirent.name);
      if (dirent.isDirectory()) {
        if (dirent.name === "node_modules" || dirent.name === "dist" || dirent.name.startsWith(".")) continue;
        walk(full);
      } else if (dirent.isFile() && dirent.name.endsWith(".abide")) {
        found.push(full);
      }
    }
  };
  walk(dir);
  found.sort();
  return found;
}

// 0-based LSP (line, character) → absolute offset in `source`.
function lineColumnToOffset(source: string, line: number, character: number): number {
  let offset = 0;
  let currentLine = 0;
  while (currentLine < line && offset < source.length) {
    if (source.charCodeAt(offset) === 10) currentLine++;
    offset++;
  }
  return Math.min(offset + character, source.length);
}

function offsetToLineColumn(source: string, offset: number): { line: number; column: number } {
  let line = 1;
  let column = 1;
  const limit = Math.min(offset, source.length);
  for (let index = 0; index < limit; index++) {
    if (source.charCodeAt(index) === 10) {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return { line, column };
}

// Lower every `.abide` under `dir` into virtual files (generated modules + `.d.ts` companions) served
// through the overlay. `overrides` supplies unsaved buffer content (keyed by absolute path) in place of
// the disk file — the source of LIVE diagnostics. Each lowering mints FRESH virtual paths (a monotonic
// `revision`) so tsgo re-reads the current content — reusing a path leaves its SourceFile cached even
// under `invalidateAll`/`clearSourceFileCache`. The engine `closeFiles` the prior revision so opens
// don't accumulate.
let revision = 0;
function lowerProject(dir: string, overrides: Record<string, string>): LoweredProject {
  const files: Record<string, string> = {};
  const modules: CheckModule[] = [];
  const parseErrors = new Map<string, ParseError>();
  const rev = ++revision; // one fresh revision per lowering, shared by all its modules
  for (const abidePath of findAbideFiles(dir)) {
    let source: string;
    try {
      source = Object.prototype.hasOwnProperty.call(overrides, abidePath) ? overrides[abidePath]! : readFileSync(abidePath, "utf8");
    } catch {
      continue;
    }
    let root: Root;
    try {
      root = parse(source, { filename: abidePath });
    } catch (error) {
      const position = error as { line?: number; column?: number };
      parseErrors.set(abidePath, { line: position.line ?? 1, column: position.column ?? 1, message: error instanceof Error ? error.message : String(error) });
      continue;
    }
    files[`${abidePath}.d.ts`] = componentDts(source, root);
    if (root.moduleScript === null && root.instanceScript === null) continue;
    const { code, segments } = emitCheck(source, root);
    const tsPath = join(dirname(abidePath), `__abide_lsp_${basename(abidePath).replace(/[^\w]/g, "_")}_${rev}.ts`);
    files[tsPath] = code;
    modules.push({ abidePath, tsPath, source, segments });
  }
  return { files, modules, parseErrors };
}

// ---------------------------------------------------------------------------
// Persistent engine — one warm tsgo `API` + a live `fs` overlay across requests
// ---------------------------------------------------------------------------

class LspEngine {
  private readonly api: API;
  private files: Record<string, string> = {};
  private opened: string[] = []; // the prior lowering's open modules, to release

  constructor(cwd: string) {
    this.api = new API({ cwd, fs: overlayFs(() => this.files) });
  }

  // Point the overlay at the current (freshly-revisioned) virtual files, RELEASE the prior revision's
  // opens (so they don't accumulate as dangling paths), and open the new ones. Fresh paths = fresh reads
  // (a reused path stays cached even under `invalidateAll`/`clearSourceFileCache`); tsgo stays warm.
  private snapshot(files: Record<string, string>, open: string[]) {
    this.files = files;
    const closeFiles = this.opened.filter((path) => !open.includes(path));
    const snapshot = this.api.updateSnapshot({ openFiles: open, closeFiles });
    this.opened = open;
    return snapshot;
  }

  // Diagnostics for the `open` generated modules.
  diagnose(files: Record<string, string>, open: string[]): RawDiagnostic[] {
    const diagnostics: RawDiagnostic[] = [];
    const snapshot = this.snapshot(files, open);
    for (const file of open) {
      const project = snapshot.getDefaultProjectForFile(file);
      if (project === undefined) continue;
      const program = project.program;
      for (const diagnostic of [...program.getSyntacticDiagnostics(file), ...program.getSemanticDiagnostics(file)]) {
        if (diagnostic.category !== DiagnosticCategory.Error) continue;
        if (CHECK_SUPPRESSED_CODES.has(diagnostic.code)) continue;
        diagnostics.push({ file: diagnostic.fileName ?? file, pos: diagnostic.pos, code: diagnostic.code, text: diagnostic.text });
      }
    }
    return diagnostics;
  }

  // Hover: the type string (+ any doc comment) at a generated-module position. Null when the position
  // resolves to nothing (e.g. inside synthetic scaffolding).
  typeAt(files: Record<string, string>, open: string[], file: string, position: number): { type: string; documentation: string } | null {
    const snapshot = this.snapshot(files, open);
    const project = snapshot.getDefaultProjectForFile(file);
    if (project === undefined) return null;
    const type = project.checker.getTypeAtPosition(file, position);
    if (type === undefined) return null;
    const symbol = project.checker.getSymbolAtPosition(file, position);
    return { type: project.checker.typeToString(type), documentation: symbol !== undefined ? symbol.getDocumentationComment(project.checker) : "" };
  }

  // Go-to-definition: the declaration site(s) of the symbol at a generated-module position, as
  // `{ file, pos, end }` in whatever file each declaration lives (a virtual generated module, a
  // `.abide.d.ts` companion, or a real `.ts`). The caller maps virtual files back to `.abide`.
  definitionAt(files: Record<string, string>, open: string[], file: string, position: number): Array<{ file: string; pos: number; end: number }> {
    const snapshot = this.snapshot(files, open);
    const project = snapshot.getDefaultProjectForFile(file);
    if (project === undefined) return [];
    const symbol = project.checker.getSymbolAtPosition(file, position);
    if (symbol === undefined) return [];
    const locations: Array<{ file: string; pos: number; end: number }> = [];
    for (const handle of symbol.declarations) {
      const node = handle.resolve(project);
      if (node === undefined) continue;
      locations.push({ file: String(handle.path), pos: node.getStart(), end: node.getEnd() });
    }
    return locations;
  }

  // Completion: the entries at a generated-module position, mapped toward LSP `CompletionItem`s. tsgo's
  // `CompletionItemKind` is already the LSP enum (it speaks LSP natively), so `kind` passes through.
  completionsAt(files: Record<string, string>, open: string[], file: string, position: number): Array<{ label: string; kind: number | undefined; detail: string | undefined; insertText: string | undefined; sortText: string | undefined }> {
    const snapshot = this.snapshot(files, open);
    const project = snapshot.getDefaultProjectForFile(file);
    if (project === undefined) return [];
    const info = project.checker.getCompletionsAtPosition(file, position);
    if (info === undefined) return [];
    // `undefined` fields are dropped by JSON.stringify, so the wire `CompletionItem`s stay clean.
    return info.entries.map((entry) => ({
      label: entry.name,
      kind: entry.kind as number | undefined,
      detail: entry.detail ?? entry.labelDetails?.detail,
      insertText: entry.insertText,
      sortText: entry.sortText,
    }));
  }

  // Signature help: walk up from the token at `position` to the enclosing call, resolve its signature,
  // and format its parameters + the active parameter (args ended before the cursor). Null when the
  // position is not inside a call.
  signatureAt(files: Record<string, string>, open: string[], file: string, position: number): { label: string; parameters: Array<{ label: string }>; activeParameter: number } | null {
    const snapshot = this.snapshot(files, open);
    const project = snapshot.getDefaultProjectForFile(file);
    if (project === undefined) return null;
    const sourceFile = project.program.getSourceFile(file);
    if (sourceFile === undefined) return null;
    let node: Node | undefined = getTokenAtPosition(sourceFile, position);
    while (node !== undefined && node.kind !== SyntaxKind.CallExpression) node = node.parent as Node | undefined;
    if (node === undefined) return null;
    const call = node as CallExpression;
    const signature = project.checker.getResolvedSignature(call);
    if (signature === undefined) return null;
    const checker = project.checker;
    const parameters = signature.getParameters().map((symbol) => {
      const type = checker.getTypeOfSymbol(symbol);
      return { label: `${symbol.name}: ${type !== undefined ? checker.typeToString(type) : "any"}` };
    });
    const returnType = checker.getReturnTypeOfSignature(signature);
    const label = `(${parameters.map((p) => p.label).join(", ")})${returnType !== undefined ? `: ${checker.typeToString(returnType)}` : ""}`;
    let activeParameter = 0;
    for (const argument of call.arguments) {
      if (position > argument.getEnd()) activeParameter++;
      else break;
    }
    return { label, parameters, activeParameter };
  }

  // Find-references: every reference NodeHandle of the symbol at a position, as `{ file, pos, end }`
  // (the caller maps each back the same way as a definition). Searches the loaded (open) modules + real
  // files; references in CLOSED `.abide` modules aren't loaded (a v1 limit, like open-doc diagnostics).
  referencesAt(files: Record<string, string>, open: string[], file: string, position: number): Array<{ file: string; pos: number; end: number }> {
    const snapshot = this.snapshot(files, open);
    const project = snapshot.getDefaultProjectForFile(file);
    if (project === undefined) return [];
    const sourceFile = project.program.getSourceFile(file);
    if (sourceFile === undefined) return [];
    const node = getTokenAtPosition(sourceFile, position);
    const locations: Array<{ file: string; pos: number; end: number }> = [];
    for (const entry of project.checker.getReferencedSymbolsForNode(node, position)) {
      for (const handle of entry.references) {
        const referenceNode = handle.resolve(project);
        if (referenceNode === undefined) continue;
        locations.push({ file: String(handle.path), pos: referenceNode.getStart(), end: referenceNode.getEnd() });
      }
    }
    return locations;
  }

  close(): void {
    this.api.close();
  }
}

// ---------------------------------------------------------------------------
// Transport + server loop
// ---------------------------------------------------------------------------

function toLspDiagnostic(line: number, column: number, code: number, message: string): LspDiagnostic {
  const l = Math.max(0, line - 1);
  const c = Math.max(0, column - 1);
  return { range: { start: { line: l, character: c }, end: { line: l, character: c + 1 } }, severity: 1, code, source: "abide", message };
}

function headerTerminator(buffer: Uint8Array): number {
  for (let i = 0; i + 3 < buffer.length; i++) {
    if (buffer[i] === 13 && buffer[i + 1] === 10 && buffer[i + 2] === 13 && buffer[i + 3] === 10) return i;
  }
  return -1;
}

export async function lspServer(options: LspServerOptions): Promise<void> {
  let projectRoot = options.projectRoot;
  let engine: LspEngine | null = null;
  const buffers = new Map<string, string>(); // abidePath -> unsaved content
  const openDocs = new Set<string>(); // abidePaths currently open
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const send = (message: object): void => {
    const body = encoder.encode(JSON.stringify(message));
    const header = encoder.encode(`Content-Length: ${body.length}\r\n\r\n`);
    const frame = new Uint8Array(header.length + body.length);
    frame.set(header, 0);
    frame.set(body, header.length);
    options.write(frame);
  };
  const publish = (abidePath: string, diagnostics: LspDiagnostic[]): void => {
    send({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: { uri: pathToFileURL(abidePath).href, diagnostics } });
  };

  const lowerCurrent = (): LoweredProject => {
    const overrides: Record<string, string> = {};
    for (const [path, content] of buffers) overrides[path] = content;
    return lowerProject(projectRoot, overrides);
  };

  const refresh = (): void => {
    if (engine === null || openDocs.size === 0) return;
    const { files, modules, parseErrors } = lowerCurrent();
    const byTs = new Map(modules.map((m) => [m.tsPath.toLowerCase(), m] as const));
    const openModulePaths = modules.filter((m) => openDocs.has(m.abidePath)).map((m) => m.tsPath);
    const raw = openModulePaths.length > 0 ? engine.diagnose(files, openModulePaths) : [];
    const byFile = new Map<string, LspDiagnostic[]>();
    for (const diagnostic of raw) {
      const module = byTs.get(diagnostic.file.toLowerCase());
      if (module === undefined || diagnostic.pos < CHECK_HEADER_LENGTH) continue;
      const { line, column } = offsetToLineColumn(module.source, mapGenToOrig(module.segments, diagnostic.pos));
      const list = byFile.get(module.abidePath) ?? [];
      list.push(toLspDiagnostic(line, column, diagnostic.code, diagnostic.text));
      byFile.set(module.abidePath, list);
    }
    // Publish for every OPEN doc (its errors, a parse error, or empty to clear stale squiggles).
    for (const abidePath of openDocs) {
      const parseError = parseErrors.get(abidePath);
      if (parseError !== undefined) publish(abidePath, [toLspDiagnostic(parseError.line, parseError.column, 0, parseError.message)]);
      else publish(abidePath, byFile.get(abidePath) ?? []);
    }
  };

  const documentPath = (params: unknown): string | undefined => {
    const uri = (params as { textDocument?: { uri?: string } } | undefined)?.textDocument?.uri;
    return uri === undefined ? undefined : fileURLToPath(uri);
  };

  // Lower the project with current buffers and map a request's `.abide` (line, character) to the
  // generated-module offset it corresponds to. Null when off an open doc or on a non-mapped (synthetic)
  // span. `open` is the open docs' generated modules (the checker's `openFiles`).
  const resolvePosition = (params: unknown): { files: Record<string, string>; modules: CheckModule[]; module: CheckModule; gen: number; open: string[] } | null => {
    if (engine === null) return null;
    const path = documentPath(params);
    const position = (params as { position?: { line: number; character: number } } | undefined)?.position;
    if (path === undefined || position === undefined || !openDocs.has(path)) return null;
    const { files, modules } = lowerCurrent();
    const module = modules.find((m) => m.abidePath === path);
    if (module === undefined) return null;
    const offset = lineColumnToOffset(module.source, position.line, position.character);
    let gen = mapOrigToGen(module.segments, offset);
    if (gen === -1 && offset > 0) {
      // Cursor at a segment boundary (e.g. right after `.` in `count.`): map the preceding char and step
      // one past it, so completion queries the position just after the mapped text.
      const previous = mapOrigToGen(module.segments, offset - 1);
      gen = previous === -1 ? -1 : previous + 1;
    }
    if (gen === -1) return null;
    return { files, modules, module, gen, open: modules.filter((m) => openDocs.has(m.abidePath)).map((m) => m.tsPath) };
  };

  const makeLocation = (file: string, source: string, startOffset: number, endOffset: number): object => {
    const start = offsetToLineColumn(source, startOffset);
    const end = offsetToLineColumn(source, endOffset);
    return { uri: pathToFileURL(file).href, range: { start: { line: start.line - 1, character: start.column - 1 }, end: { line: end.line - 1, character: end.column - 1 } } };
  };

  // Map a declaration site to an LSP Location: a virtual generated module → back to its `.abide` (via
  // segments); a `.abide.d.ts` companion (synthetic) → the top of the `.abide`; a real `.ts` → as-is.
  // `byTs` is keyed lowercase — tsgo canonicalizes `handle.path` on a case-insensitive filesystem.
  const declToLocation = (decl: { file: string; pos: number; end: number }, byTs: Map<string, CheckModule>): object | null => {
    const module = byTs.get(decl.file.toLowerCase());
    if (module !== undefined) {
      if (decl.pos < CHECK_HEADER_LENGTH) return null;
      return makeLocation(module.abidePath, module.source, mapGenToOrig(module.segments, decl.pos), mapGenToOrig(module.segments, decl.end));
    }
    if (decl.file.endsWith(".abide.d.ts")) {
      return { uri: pathToFileURL(decl.file.slice(0, -".d.ts".length)).href, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } };
    }
    let source: string;
    try {
      source = readFileSync(decl.file, "utf8");
    } catch {
      return null;
    }
    return makeLocation(decl.file, source, decl.pos, decl.end);
  };

  const handle = (message: JsonRpcMessage): boolean => {
    switch (message.method) {
      case "initialize": {
        const params = message.params as { rootUri?: string | null; rootPath?: string } | undefined;
        if (params?.rootUri) projectRoot = fileURLToPath(params.rootUri);
        else if (params?.rootPath) projectRoot = params.rootPath;
        engine = new LspEngine(projectRoot);
        send({ jsonrpc: "2.0", id: message.id, result: { capabilities: { textDocumentSync: { openClose: true, change: 1, save: true }, hoverProvider: true, definitionProvider: true, completionProvider: { triggerCharacters: ["."] }, signatureHelpProvider: { triggerCharacters: ["(", ","] }, referencesProvider: true } } });
        return false;
      }
      case "initialized":
        return false;
      case "textDocument/didOpen": {
        const path = documentPath(message.params);
        const text = (message.params as { textDocument?: { text?: string } } | undefined)?.textDocument?.text;
        if (path !== undefined && text !== undefined) {
          buffers.set(path, text);
          openDocs.add(path);
          refresh();
        }
        return false;
      }
      case "textDocument/didChange": {
        const path = documentPath(message.params);
        const changes = (message.params as { contentChanges?: Array<{ text?: string }> } | undefined)?.contentChanges;
        const text = changes !== undefined && changes.length > 0 ? changes[changes.length - 1]!.text : undefined;
        if (path !== undefined && text !== undefined) {
          buffers.set(path, text);
          refresh();
        }
        return false;
      }
      case "textDocument/didSave": {
        const path = documentPath(message.params);
        if (path !== undefined) refresh();
        return false;
      }
      case "textDocument/didClose": {
        const path = documentPath(message.params);
        if (path !== undefined) {
          buffers.delete(path);
          openDocs.delete(path);
          publish(path, []); // clear on close
        }
        return false;
      }
      case "textDocument/hover": {
        const target = resolvePosition(message.params);
        let result: object | null = null;
        if (target !== null && engine !== null) {
          const info = engine.typeAt(target.files, target.open, target.module.tsPath, target.gen);
          if (info !== null) {
            const value = `\`\`\`typescript\n${info.type}\n\`\`\`${info.documentation ? `\n\n${info.documentation}` : ""}`;
            result = { contents: { kind: "markdown", value } };
          }
        }
        send({ jsonrpc: "2.0", id: message.id, result });
        return false;
      }
      case "textDocument/definition": {
        const target = resolvePosition(message.params);
        let result: object[] | null = null;
        if (target !== null && engine !== null) {
          const byTs = new Map(target.modules.map((m) => [m.tsPath.toLowerCase(), m] as const));
          const locations: object[] = [];
          for (const decl of engine.definitionAt(target.files, target.open, target.module.tsPath, target.gen)) {
            const location = declToLocation(decl, byTs);
            if (location !== null) locations.push(location);
          }
          if (locations.length > 0) result = locations;
        }
        send({ jsonrpc: "2.0", id: message.id, result });
        return false;
      }
      case "textDocument/completion": {
        const target = resolvePosition(message.params);
        let result: object | null = null;
        if (target !== null && engine !== null) {
          result = { isIncomplete: false, items: engine.completionsAt(target.files, target.open, target.module.tsPath, target.gen) };
        }
        send({ jsonrpc: "2.0", id: message.id, result });
        return false;
      }
      case "textDocument/signatureHelp": {
        const target = resolvePosition(message.params);
        let result: object | null = null;
        if (target !== null && engine !== null) {
          const info = engine.signatureAt(target.files, target.open, target.module.tsPath, target.gen);
          if (info !== null) result = { signatures: [{ label: info.label, parameters: info.parameters }], activeSignature: 0, activeParameter: info.activeParameter };
        }
        send({ jsonrpc: "2.0", id: message.id, result });
        return false;
      }
      case "textDocument/references": {
        const target = resolvePosition(message.params);
        let result: object[] = [];
        if (target !== null && engine !== null) {
          const byTs = new Map(target.modules.map((m) => [m.tsPath.toLowerCase(), m] as const));
          for (const reference of engine.referencesAt(target.files, target.open, target.module.tsPath, target.gen)) {
            const location = declToLocation(reference, byTs);
            if (location !== null) result.push(location);
          }
        }
        send({ jsonrpc: "2.0", id: message.id, result });
        return false;
      }
      case "shutdown":
        send({ jsonrpc: "2.0", id: message.id, result: null });
        return false;
      case "exit":
        engine?.close();
        return true;
      default:
        if (message.id !== undefined) send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `Unhandled method: ${message.method}` } });
        return false;
    }
  };

  const reader = options.read.getReader();
  let buffer = new Uint8Array(0);
  for (;;) {
    const terminator = headerTerminator(buffer);
    if (terminator !== -1) {
      const header = decoder.decode(buffer.subarray(0, terminator));
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      const bodyStart = terminator + 4;
      if (match === null) {
        buffer = buffer.slice(bodyStart);
        continue;
      }
      const length = Number(match[1]);
      if (buffer.length >= bodyStart + length) {
        const body = decoder.decode(buffer.subarray(bodyStart, bodyStart + length));
        buffer = buffer.slice(bodyStart + length);
        let message: JsonRpcMessage | undefined;
        try {
          message = JSON.parse(body) as JsonRpcMessage;
        } catch {
          message = undefined;
        }
        if (message !== undefined && handle(message)) break;
        continue;
      }
    }
    const chunk = await reader.read();
    if (chunk.done) break;
    const merged = new Uint8Array(buffer.length + chunk.value.length);
    merged.set(buffer, 0);
    merged.set(chunk.value, buffer.length);
    buffer = merged;
  }
  reader.releaseLock();
}

// node entry: `node lsp.ts` (the process `abide lsp` forwards to). Wires real stdio.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const read = Readable.toWeb(process.stdin) as unknown as ReadableStream<Uint8Array>;
  void lspServer({ projectRoot: process.cwd(), read, write: (bytes) => void process.stdout.write(bytes) });
}
