// `.abide` TYPE-CHECK LOWERING (C10.2–6, TODO #11 PR1) — the typed-lowering emitter.
//
// Produces a TYPE-ONLY TS module (never executed) that both `abide check` and `abide lsp` feed to the
// TS7 type engine. Unlike the runtime emitters (`emitClient`/`emitServer`), which resolve free
// template identifiers to `$scope.<name>` (type-erasing), this lowering preserves types: script cells
// stay `T` (via `__abideUnwrap`), and every TEMPLATE expression is emitted as real lexically-scoped TS
// so TS's own scoping + control-flow narrowing does the work.
//
// THE ONE INVARIANT (mapping depends on it): user code is copied VERBATIM into the generated module;
// only synthetic scaffolding (`__ref(` … `)`, `if (` … `)`, `__abideUnwrap(` …) is injected around it.
// So a `Segment[]` (verbatim spans, monotonic in BOTH gen and orig offsets) maps positions
// bidirectionally (gen↔orig) by binary search. `emitCheck` must NEVER rewrite INSIDE a user expression.
//
// SCOPE (PR1 = intra-file): interpolation, html, await, if/for/await/try/switch/snippet, element +
// component attribute expressions, and control-flow bindings — all typed in the correct lexical scope.
// Component invocations are checked for VALUE validity (each prop expression) but the component itself
// is opaque (the `.abide` ambient module types the default import as `any`); CROSS-file typed component
// signatures are PR2. Quoted attribute-value interpolation (`title="x {n}"`) and branch-local
// `<script>`s are deferred. See `docs/spec/abide-check-lsp-plan.md`.

import { createScanner } from "typescript/unstable/ast/scanner";
import { SyntaxKind } from "typescript/unstable/ast";
import type { Root, Script, TemplateNode, AttributeNode } from "./ast.ts";

// A verbatim span of the generated file: [genStart, genEnd) maps to original offset `origStart`.
export interface Segment {
  genStart: number;
  genEnd: number;
  origStart: number;
}

export interface CheckModule {
  code: string;
  segments: Segment[];
  // Bytes of the synthetic header prefix; a diagnostic before it is framework scaffolding, not user code.
  headerLength: number;
}

// Synthetic preamble. Self-contained (no imports → resolves in any project). `__abideUnwrap` models the
// runtime `$def` accessor (a state cell reads/writes as its value → `any`, dodging narrow-literal false
// positives); `__ref` forces an expression to be type-checked without an unused-expression lint;
// `__entries` types `{#for item, i}` as `[index, item]`; `children` is the intrinsic slot callable.
const HEADER =
  `interface __AbideStateCell<__T> { read(): __T; write(value: __T): void; peek(): __T; }\n` +
  `declare function __abideUnwrap<__T>(cell: __AbideStateCell<__T>): any;\n` +
  `declare function __abideUnwrap<__T>(value: __T): __T;\n` +
  `declare function __ref(value: unknown): void;\n` +
  `declare function __entries<__T>(list: Iterable<__T> | ArrayLike<__T>): IterableIterator<[number, __T]>;\n` +
  `declare function children(): unknown;\n`;

export const CHECK_HEADER_LENGTH = HEADER.length;

// ---------------------------------------------------------------------------
// Top-level
// ---------------------------------------------------------------------------

export function emitCheck(source: string, root: Root): CheckModule {
  const segments: Segment[] = [];
  let code = "";

  const emitOriginal = (absStart: number, text: string): void => {
    if (text.length === 0) return;
    segments.push({ genStart: code.length, genEnd: code.length + text.length, origStart: absStart });
    code += text;
  };
  const emitSynthetic = (text: string): void => {
    code += text;
  };
  // Absolute offset of `exprText` within `[from, to)`, or -1. Callers advance `from` past a match so
  // short/substring names in a multi-expression header (`{#for item, i …}` — `i` inside `item`) resolve
  // in source order without colliding.
  const locate = (from: number, to: number, exprText: string): number => {
    const at = source.slice(from, to).indexOf(exprText);
    return at === -1 ? -1 : from + at;
  };
  // Copy `len` bytes of verbatim source at absolute offset `abs` (records a Segment for the map).
  const emitAt = (abs: number, len: number): void => {
    emitOriginal(abs, source.slice(abs, abs + len));
  };
  // Locate `exprText` within a node span and copy it verbatim; fall back to un-mapped synthetic text.
  const emitExpr = (nodeStart: number, nodeEnd: number, exprText: string): void => {
    const at = locate(nodeStart, nodeEnd, exprText);
    if (at === -1) emitSynthetic(exprText);
    else emitAt(at, exprText.length);
  };

  emitSynthetic(HEADER);

  // Module + instance scripts first (declarations in scope for the template closure).
  const scripts: Script[] = [];
  if (root.moduleScript !== null) scripts.push(root.moduleScript);
  if (root.instanceScript !== null) scripts.push(root.instanceScript);
  for (const script of scripts) emitScript(source, script, emitOriginal, emitSynthetic);

  // Template render body — `async` so `{await …}` / `{#await}` / `{#for await}` are legal (the `await`
  // lives INSIDE the function, so no top-level-await requirement on the project). Called below so it is
  // not flagged unused under `noUnusedLocals`; the call is a statement (no unused-expression lint).
  emitSynthetic("async function __render() {\n");
  walk(root.children, { source, emitSynthetic, emitExpr, emitAt, locate });
  emitSynthetic("}\n__render();\n");

  emitSynthetic("export {};\n");
  return { code, segments, headerLength: HEADER.length };
}

// ---------------------------------------------------------------------------
// Component `.d.ts` companion (PR2 cross-file component-prop typing)
// ---------------------------------------------------------------------------

// Scan from the `<` at `ltIndex` to its matching `>` (balanced over `<>`, skipping strings and the
// arrow `=>`). Returns the matching `>` index, or -1.
function scanBalancedAngle(text: string, ltIndex: number): number {
  let depth = 0;
  for (let i = ltIndex; i < text.length; i++) {
    const c = text[i]!;
    if (c === "'" || c === '"' || c === "`") {
      i = skipString(text, i);
      continue;
    }
    if (c === "<") depth++;
    else if (c === ">") {
      if (text[i - 1] === "=") continue; // arrow `=>` inside a function type
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// The props type for a component's default export. Explicit `props<T>()` → `T` (CLOSED — strict, per
// the graduated model: unknown props error); otherwise `Record<string, unknown>` (OPEN — accepts
// anything, zero false positives). `props` assumed un-aliased (the documented import name).
function deriveProps(source: string, root: Root): string {
  const scripts: Script[] = [];
  if (root.moduleScript !== null) scripts.push(root.moduleScript);
  if (root.instanceScript !== null) scripts.push(root.instanceScript);
  for (const script of scripts) {
    const content = source.slice(script.contentStart, script.contentEnd);
    const match = /\bprops\s*</.exec(content);
    if (match !== null) {
      const lt = match.index + match[0].length - 1;
      const gt = scanBalancedAngle(content, lt);
      if (gt !== -1) return content.slice(lt + 1, gt).trim();
    }
  }
  return "Record<string, unknown>";
}

// The typed `.d.ts` companion for a `.abide` file: its default export as a component whose props are
// `deriveProps`. Written next to the `.abide` during `abide check` so a verbatim `import X from
// "./X.abide"` resolves to this typed default instead of the ambient `declare module "*.abide"` (any).
// Errors INSIDE this file are never collected (only checked temp modules are), so a `props<T>()` that
// references an unimported type degrades that prop to `any` (no check, no false positive) — v1 omits
// the component's imports deliberately.
export function componentDts(source: string, root: Root): string {
  return (
    `type __AbideProps = ${deriveProps(source, root)};\n` +
    `declare const _default: (props: __AbideProps, children?: () => unknown) => unknown;\n` +
    `export default _default;\n`
  );
}

// ---------------------------------------------------------------------------
// Template walk
// ---------------------------------------------------------------------------

interface WalkEmit {
  source: string;
  emitSynthetic: (text: string) => void;
  emitExpr: (nodeStart: number, nodeEnd: number, exprText: string) => void;
  emitAt: (abs: number, len: number) => void;
  locate: (from: number, to: number, exprText: string) => number;
}

// Emit a `__ref(<verbatim expr>);` guard so the expression is type-checked in the current scope.
function refExpr(node: { start: number; end: number }, expr: string, e: WalkEmit): void {
  e.emitSynthetic("__ref(");
  e.emitExpr(node.start, node.end, expr);
  e.emitSynthetic(");\n");
}

function walk(nodes: TemplateNode[], e: WalkEmit): void {
  for (const node of nodes) walkNode(node, e);
}

function walkNode(node: TemplateNode, e: WalkEmit): void {
  switch (node.type) {
    case "Text":
    case "Comment":
    case "Script": // root scripts already emitted; branch-local scripts deferred (PR1 limit)
    case "Style":
      return;
    case "Interpolation":
      // `{children()}` / `{name(args)}` snippet calls are ordinary interpolations — checked as-is.
      refExpr(node, node.expression, e);
      return;
    case "Html":
      refExpr(node, node.expression, e);
      return;
    case "AwaitInterpolation":
      e.emitSynthetic("__ref(await (");
      e.emitExpr(node.start, node.end, node.expression);
      e.emitSynthetic("));\n");
      return;
    case "Element":
      emitAttributes(node.attributes, e);
      walk(node.children, e);
      return;
    case "Component":
      emitComponentCall(node, e);
      return;
    case "IfBlock":
      emitIf(node, e);
      return;
    case "ForBlock":
      emitFor(node, e);
      return;
    case "AwaitBlock":
      emitAwait(node, e);
      return;
    case "SwitchBlock":
      emitSwitch(node, e);
      return;
    case "TryBlock":
      emitTry(node, e);
      return;
    case "SnippetBlock":
      emitSnippet(node, e);
      return;
  }
}

function emitAttributes(attributes: AttributeNode[], e: WalkEmit): void {
  for (const attribute of attributes) {
    switch (attribute.type) {
      case "StaticAttribute":
        // `name="v"` / boolean — no expression to check (quoted-value `{n}` interpolation is a PR1 gap).
        break;
      case "ExpressionAttribute":
      case "EventAttribute":
      case "SpreadAttribute":
        refExpr(attribute, attribute.expression, e);
        break;
      case "BindDirective":
      case "ClassDirective":
      case "StyleDirective":
        if (attribute.expression !== null) refExpr(attribute, attribute.expression, e);
        break;
    }
  }
}

// A component invocation `<Name a={x} b="lit" {...r}>…</Name>` → a typed call
// `Name({ "a": (x), "b": "lit", ...(r) }, () => { <children> })` against the component's `.d.ts`-declared
// props (PR2 cross-file). Prop VALUES are verbatim (mapped); keys + call scaffolding are synthetic;
// children ride an opaque `() => unknown` slot. Excess-property checks catch typo'd props on a CLOSED
// `props<T>()`; a spread or an OPEN (bare-props → `Record<string,unknown>`) component relaxes them.
function emitComponentCall(node: Extract<TemplateNode, { type: "Component" }>, e: WalkEmit): void {
  e.emitExpr(node.start, node.end, node.name);
  e.emitSynthetic("({");
  for (const attr of node.attributes) {
    switch (attr.type) {
      case "StaticAttribute":
        e.emitSynthetic(` ${JSON.stringify(attr.name)}: ${attr.value === null ? "true" : JSON.stringify(attr.value)},`);
        break;
      case "ExpressionAttribute":
      case "EventAttribute":
        e.emitSynthetic(` ${JSON.stringify(attr.name)}: (`);
        e.emitExpr(attr.start, attr.end, attr.expression);
        e.emitSynthetic("),");
        break;
      case "BindDirective":
      case "ClassDirective":
      case "StyleDirective":
        if (attr.expression !== null) {
          e.emitSynthetic(` ${JSON.stringify(attr.name)}: (`);
          e.emitExpr(attr.start, attr.end, attr.expression);
          e.emitSynthetic("),");
        }
        break;
      case "SpreadAttribute":
        e.emitSynthetic(" ...(");
        e.emitExpr(attr.start, attr.end, attr.expression);
        e.emitSynthetic("),");
        break;
    }
  }
  e.emitSynthetic(" }");
  if (node.children.length > 0) {
    // `async` so `{await}` / `{#await}` / `{#for await}` inside the component's children keep their
    // async context (the slot type `() => unknown` accepts an async thunk — it returns a Promise).
    e.emitSynthetic(", async () => {\n");
    walk(node.children, e);
    e.emitSynthetic("}");
  }
  e.emitSynthetic(");\n");
}

function emitIf(node: Extract<TemplateNode, { type: "IfBlock" }>, e: WalkEmit): void {
  node.branches.forEach((branch, index) => {
    if (branch.condition === null) {
      e.emitSynthetic(" else {\n");
    } else {
      e.emitSynthetic(index === 0 ? "if (" : " else if (");
      e.emitExpr(branch.start, branch.end, branch.condition);
      e.emitSynthetic(") {\n");
    }
    walk(branch.children, e);
    e.emitSynthetic("}");
  });
  e.emitSynthetic("\n");
}

function emitFor(node: Extract<TemplateNode, { type: "ForBlock" }>, e: WalkEmit): void {
  // Locate the header expressions in SOURCE order (`item`, `index`, `iterable`, `by key`) with an
  // advancing cursor, so a short binding name that is a substring of an earlier one can't collide.
  let cursor = node.start;
  const advance = (text: string): number => {
    const at = e.locate(cursor, node.end, text);
    if (at !== -1) cursor = at + text.length;
    return at;
  };
  const itemAt = advance(node.item);
  const indexAt = node.index !== null ? advance(node.index) : -1;
  const iterAt = advance(node.iterable);
  const keyAt = node.key !== null ? advance(node.key) : -1;
  // Emit a located span verbatim, or fall back to un-mapped synthetic text.
  const put = (at: number, text: string): void => {
    if (at !== -1) e.emitAt(at, text.length);
    else e.emitSynthetic(text);
  };

  if (node.await) {
    // `{#for await item of source}` — async iterable; optional `{:catch e}`.
    if (node.catch !== null) e.emitSynthetic("try {\n");
    e.emitSynthetic("for await (const ");
    put(itemAt, node.item);
    e.emitSynthetic(" of (");
    put(iterAt, node.iterable);
    e.emitSynthetic(")) {\n");
    walk(node.children, e);
    e.emitSynthetic("}\n");
    if (node.catch !== null) {
      e.emitSynthetic(`} catch (${node.catch.param ?? "__e"}) {\n`);
      walk(node.catch.children, e);
      e.emitSynthetic("}\n");
    }
    return;
  }
  if (node.index !== null) {
    e.emitSynthetic("for (const [");
    put(indexAt, node.index);
    e.emitSynthetic(", ");
    put(itemAt, node.item);
    e.emitSynthetic("] of __entries(");
    put(iterAt, node.iterable);
    e.emitSynthetic(")) {\n");
  } else {
    e.emitSynthetic("for (const ");
    put(itemAt, node.item);
    e.emitSynthetic(" of (");
    put(iterAt, node.iterable);
    e.emitSynthetic(")) {\n");
  }
  if (node.key !== null) {
    // `by key` references the item binding — check it inside the loop body.
    e.emitSynthetic("__ref(");
    put(keyAt, node.key);
    e.emitSynthetic(");\n");
  }
  walk(node.children, e);
  e.emitSynthetic("}\n");
}

function emitAwait(node: Extract<TemplateNode, { type: "AwaitBlock" }>, e: WalkEmit): void {
  e.emitSynthetic("{\n");
  walk(node.pending, e);
  e.emitSynthetic("try {\n");
  if (node.then !== null && node.then.param !== null) {
    e.emitSynthetic("const ");
    e.emitSynthetic(node.then.param);
    e.emitSynthetic(" = await (");
    e.emitExpr(node.start, node.end, node.expression);
    e.emitSynthetic(");\n");
  } else {
    e.emitSynthetic("await (");
    e.emitExpr(node.start, node.end, node.expression);
    e.emitSynthetic(");\n");
  }
  if (node.then !== null) walk(node.then.children, e);
  e.emitSynthetic(`} catch (${node.catch?.param ?? "__e"}) {\n`);
  if (node.catch !== null) walk(node.catch.children, e);
  e.emitSynthetic("}\n");
  if (node.finally !== null) {
    e.emitSynthetic("{\n");
    walk(node.finally.children, e);
    e.emitSynthetic("}\n");
  }
  e.emitSynthetic("}\n");
}

function emitSwitch(node: Extract<TemplateNode, { type: "SwitchBlock" }>, e: WalkEmit): void {
  walk(node.leading, e);
  e.emitSynthetic("switch (");
  e.emitExpr(node.start, node.end, node.discriminant);
  e.emitSynthetic(") {\n");
  for (const arm of node.cases) {
    if (arm.test === null) {
      e.emitSynthetic("default: {\n");
    } else {
      e.emitSynthetic("case (");
      e.emitExpr(arm.start, arm.end, arm.test);
      e.emitSynthetic("): {\n");
    }
    walk(arm.children, e);
    e.emitSynthetic("break;\n}\n");
  }
  e.emitSynthetic("}\n");
}

function emitTry(node: Extract<TemplateNode, { type: "TryBlock" }>, e: WalkEmit): void {
  e.emitSynthetic("try {\n");
  walk(node.children, e);
  e.emitSynthetic(`} catch (${node.catch?.param ?? "__e"}) {\n`);
  if (node.catch !== null) walk(node.catch.children, e);
  e.emitSynthetic("}\n");
  if (node.finally !== null) {
    e.emitSynthetic("{\n");
    walk(node.finally.children, e);
    e.emitSynthetic("}\n");
  }
}

function emitSnippet(node: Extract<TemplateNode, { type: "SnippetBlock" }>, e: WalkEmit): void {
  e.emitSynthetic("function ");
  e.emitSynthetic(node.name);
  e.emitSynthetic("(");
  if (node.params.trim().length > 0) e.emitExpr(node.start, node.end, node.params);
  e.emitSynthetic(") {\n");
  walk(node.children, e);
  e.emitSynthetic("}\n");
}

// ---------------------------------------------------------------------------
// Script lowering (moved from check.ts — the script-only subset)
// ---------------------------------------------------------------------------

const OPEN = new Set<SyntaxKind>([SyntaxKind.OpenParenToken, SyntaxKind.OpenBracketToken, SyntaxKind.OpenBraceToken]);
const CLOSE = new Set<SyntaxKind>([SyntaxKind.CloseParenToken, SyntaxKind.CloseBracketToken, SyntaxKind.CloseBraceToken]);

function emitScript(source: string, script: Script, emitOriginal: (absStart: number, text: string) => void, emitSynthetic: (text: string) => void): void {
  const content = source.slice(script.contentStart, script.contentEnd);
  const base = script.contentStart;
  const scanner = createScanner(true, /* Standard */ 0, content);
  let copyFrom = 0;
  let depth = 0;
  let atStatementStart = true;

  const flush = (uptoRel: number): void => {
    if (uptoRel > copyFrom) emitOriginal(base + copyFrom, content.slice(copyFrom, uptoRel));
    copyFrom = uptoRel;
  };

  const scanToStatementEnd = (): { rawEnd: number; end: number } => {
    let localDepth = 0;
    let prevEnd = scanner.getTokenEnd();
    for (;;) {
      const token = scanner.scan();
      if (token === SyntaxKind.EndOfFile) return { rawEnd: prevEnd, end: prevEnd };
      if (localDepth === 0 && scanner.hasPrecedingLineBreak()) return { rawEnd: prevEnd, end: prevEnd };
      if (localDepth === 0 && token === SyntaxKind.SemicolonToken) return { rawEnd: scanner.getTokenStart(), end: scanner.getTokenEnd() };
      if (OPEN.has(token)) localDepth++;
      else if (CLOSE.has(token)) localDepth--;
      prevEnd = scanner.getTokenEnd();
    }
  };

  for (;;) {
    const token = scanner.scan();
    if (token === SyntaxKind.EndOfFile) break;
    if (depth === 0 && scanner.hasPrecedingLineBreak()) atStatementStart = true;
    if (depth === 0 && atStatementStart) {
      if (token === SyntaxKind.AsyncKeyword) continue;
      if (token === SyntaxKind.LetKeyword || token === SyntaxKind.ConstKeyword || token === SyntaxKind.VarKeyword) {
        const keyword = scanner.getTokenText();
        const start = scanner.getTokenStart();
        const declaratorsStart = scanner.getTokenEnd();
        const { rawEnd, end } = scanToStatementEnd();
        flush(start);
        const rawDeclarators = content.slice(declaratorsStart, rawEnd);
        emitDeclarators(keyword, rawDeclarators, base + declaratorsStart, emitOriginal, emitSynthetic);
        copyFrom = end;
        scanner.resetTokenState(end);
        atStatementStart = true;
        continue;
      }
    }
    if (OPEN.has(token)) depth++;
    else if (CLOSE.has(token)) depth--;
    if (depth === 0 && (token === SyntaxKind.SemicolonToken || token === SyntaxKind.CloseBraceToken)) atStatementStart = true;
    else atStatementStart = false;
  }

  flush(content.length);
  emitSynthetic("\n");
}

function emitDeclarators(keyword: string, rawDeclarators: string, absBase: number, emitOriginal: (absStart: number, text: string) => void, emitSynthetic: (text: string) => void): void {
  for (const part of splitTopLevelCommas(rawDeclarators)) {
    const text = part.text;
    const partAbs = absBase + part.start;
    const equalsIndex = topLevelIndexOf(text, "=");
    const pattern = (equalsIndex === -1 ? text : text.slice(0, equalsIndex)).trim();
    if (pattern === "") continue;
    const isSimple = /^[A-Za-z_$][\w$]*$/.test(pattern);
    if (!isSimple || equalsIndex === -1) {
      emitSynthetic(`${keyword} `);
      emitOriginal(partAbs, text);
      emitSynthetic(";\n");
      continue;
    }
    const patternText = text.slice(0, equalsIndex);
    const initText = text.slice(equalsIndex + 1);
    emitSynthetic(`${keyword} `);
    emitOriginal(partAbs, patternText);
    emitSynthetic(`= __abideUnwrap(`);
    emitOriginal(partAbs + equalsIndex + 1, initText);
    emitSynthetic(`);\n`);
  }
}

// ---------------------------------------------------------------------------
// String utilities (depth + quote aware)
// ---------------------------------------------------------------------------

function skipString(text: string, openIndex: number): number {
  const quote = text[openIndex];
  let index = openIndex + 1;
  while (index < text.length) {
    if (text[index] === "\\") {
      index += 2;
      continue;
    }
    if (text[index] === quote) return index;
    index++;
  }
  return index;
}

interface CommaPart {
  text: string;
  start: number;
}

function splitTopLevelCommas(text: string): CommaPart[] {
  const parts: CommaPart[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (char === "'" || char === '"' || char === "`") {
      index = skipString(text, index);
      continue;
    }
    if (char === "{" || char === "[" || char === "(") depth++;
    else if (char === "}" || char === "]" || char === ")") depth--;
    else if (char === "," && depth === 0) {
      parts.push({ text: text.slice(start, index), start });
      start = index + 1;
    }
  }
  parts.push({ text: text.slice(start), start });
  return parts;
}

function topLevelIndexOf(text: string, target: string): number {
  let depth = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (char === "'" || char === '"' || char === "`") {
      index = skipString(text, index);
      continue;
    }
    if (char === "{" || char === "[" || char === "(") depth++;
    else if (char === "}" || char === "]" || char === ")") depth--;
    else if (depth === 0 && char === target) return index;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Bidirectional offset mapping
// ---------------------------------------------------------------------------

// Generated offset → original `.abide` offset. Positions inside synthetic scaffolding snap to the
// nearest following (else preceding) verbatim segment (best-effort; see §1.11 of the plan).
export function mapGenToOrig(segments: Segment[], genPos: number): number {
  for (const segment of segments) {
    if (genPos >= segment.genStart && genPos < segment.genEnd) return segment.origStart + (genPos - segment.genStart);
  }
  let best: Segment | undefined;
  for (const segment of segments) {
    if (segment.genStart >= genPos) {
      best = segment;
      break;
    }
  }
  if (best !== undefined) return best.origStart;
  const last = segments[segments.length - 1];
  return last !== undefined ? last.origStart : 0;
}

// Original `.abide` offset → generated offset. Used by the LSP to translate an editor position into the
// generated module before querying the checker. Segments are monotonic in `origStart`, so the same
// array answers both directions. A position not inside any verbatim segment (synthetic-only) returns -1.
export function mapOrigToGen(segments: Segment[], origPos: number): number {
  for (const segment of segments) {
    const origEnd = segment.origStart + (segment.genEnd - segment.genStart);
    if (origPos >= segment.origStart && origPos < origEnd) return segment.genStart + (origPos - segment.origStart);
  }
  return -1;
}
