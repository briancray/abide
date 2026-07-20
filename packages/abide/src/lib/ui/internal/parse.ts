// Hand-written recursive-descent parser for `.abide` templates (M4a).
//
// Syntax only: no codegen, no type-checking (those are M4b/M4c). Expressions inside `{ ... }`,
// attribute values, block headers, and script/style bodies are captured as raw strings — never
// JS/CSS-parsed. Brace/paren/bracket/quote/backtick balancing is used only to find the correct
// closing delimiter of an interpolation or header. Every node records source offsets.
//
// See ast.ts for the node shapes and docs/spec/abide-compiler.md (C1–C9) / CLAUDE.md for grammar.

import type {
  AttributeNode,
  AwaitBlock,
  Clause,
  Comment,
  Component,
  Element,
  ForBlock,
  Html,
  IfBlock,
  IfBranch,
  ParamClause,
  Root,
  Script,
  Style,
  SwitchBlock,
  SwitchCase,
  TemplateNode,
  Text,
  TryBlock,
} from "./ast.ts";

// HTML void elements — no closing tag, no children.
const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

// A positioned parse failure. `offset` is the source position; `line`/`column` are 1-based.
export class ParseError extends Error {
  readonly offset: number;
  readonly line: number;
  readonly column: number;
  readonly filename: string | undefined;

  constructor(message: string, offset: number, line: number, column: number, filename: string | undefined) {
    const where = filename ? `${filename}:${line}:${column}` : `${line}:${column}`;
    super(`${message} (${where})`);
    this.name = "ParseError";
    this.offset = offset;
    this.line = line;
    this.column = column;
    this.filename = filename;
  }
}

const IDENT_CHAR = /[A-Za-z0-9_$]/;

export function parse(source: string, opts?: { filename?: string }): Root {
  const length = source.length;
  const filename = opts?.filename;
  let pos = 0;

  // --- diagnostics -------------------------------------------------------

  function fail(message: string, at: number = pos): never {
    let line = 1;
    let column = 1;
    for (let index = 0; index < at && index < length; index++) {
      if (source.charCodeAt(index) === 10) {
        line++;
        column = 1;
      } else {
        column++;
      }
    }
    throw new ParseError(message, at, line, column, filename);
  }

  // --- low-level scanners ------------------------------------------------

  function isWhitespace(code: number): boolean {
    return code === 32 || code === 9 || code === 10 || code === 13 || code === 12;
  }

  function skipWhitespace(): void {
    while (pos < length && isWhitespace(source.charCodeAt(pos))) pos++;
  }

  // Advance past a quoted string starting at `pos` (the opening quote). Handles backslash escapes.
  function scanString(quote: string): void {
    const start = pos;
    pos++; // opening quote
    while (pos < length) {
      const char = source[pos];
      if (char === "\\") {
        pos += 2;
        continue;
      }
      if (char === quote) {
        pos++;
        return;
      }
      pos++;
    }
    fail("unterminated string literal", start);
  }

  // Advance past a template literal starting at `pos` (the opening backtick), including nested
  // `${ ... }` interpolations which may themselves contain strings, template literals, and braces.
  function scanTemplateLiteral(): void {
    const start = pos;
    pos++; // opening backtick
    while (pos < length) {
      const char = source[pos];
      if (char === "\\") {
        pos += 2;
        continue;
      }
      if (char === "`") {
        pos++;
        return;
      }
      if (char === "$" && source[pos + 1] === "{") {
        pos += 2;
        scanBalancedUntilBrace();
        if (pos >= length) fail("unterminated template literal", start);
        pos++; // closing brace of ${ ... }
        continue;
      }
      pos++;
    }
    fail("unterminated template literal", start);
  }

  // From `pos`, advance over balanced expression text until the matching top-level `}` (which is
  // NOT consumed). Nested `()[]{}`, strings, and template literals are skipped as units. Stops at
  // end of input (caller decides whether that is an error).
  function scanBalancedUntilBrace(): void {
    let depth = 0;
    while (pos < length) {
      const char = source[pos];
      if (char === "'" || char === '"') {
        scanString(char);
        continue;
      }
      if (char === "`") {
        scanTemplateLiteral();
        continue;
      }
      if (char === "(" || char === "[" || char === "{") {
        depth++;
        pos++;
        continue;
      }
      if (char === ")" || char === "]") {
        depth--;
        pos++;
        continue;
      }
      if (char === "}") {
        if (depth === 0) return;
        depth--;
        pos++;
        continue;
      }
      pos++;
    }
  }

  // Read the raw contents of a `{ ... }` — `pos` must be just after the opening `{`. Consumes the
  // closing `}`. Returns the raw (untrimmed) inner text.
  function readBraceContents(): string {
    const start = pos;
    scanBalancedUntilBrace();
    if (pos >= length) fail("unclosed `{`", start - 1);
    const raw = source.slice(start, pos);
    pos++; // closing brace
    return raw;
  }

  function readTagName(): string {
    const start = pos;
    while (pos < length && /[A-Za-z0-9._-]/.test(source[pos]!)) pos++;
    if (pos === start) fail("expected a tag name");
    return source.slice(start, pos);
  }

  function readIdentifier(): string {
    const start = pos;
    while (pos < length && IDENT_CHAR.test(source[pos]!)) pos++;
    return source.slice(start, pos);
  }

  // --- token lookahead ---------------------------------------------------

  function atClauseOpen(): boolean {
    return source[pos] === "{" && source[pos + 1] === ":";
  }

  function atBlockClose(): boolean {
    return source[pos] === "{" && source[pos + 1] === "/";
  }

  // Consume `{:`, read and return the clause keyword (e.g. "else", "then", "catch"). `pos` is left
  // just after the keyword.
  function consumeClauseKeyword(): string {
    pos += 2; // `{:`
    const keyword = readIdentifier();
    if (keyword === "") fail("expected a clause keyword after `{:`");
    return keyword;
  }

  // Consume `{/name}`; errors on a name mismatch or missing `}`.
  function consumeBlockClose(name: string): void {
    if (!atBlockClose()) fail(`expected \`{/${name}}\``);
    pos += 2; // `{/`
    const actual = readIdentifier();
    if (actual !== name) fail(`expected \`{/${name}}\` but found \`{/${actual}}\``, pos - actual.length - 2);
    skipWhitespace();
    if (source[pos] !== "}") fail(`expected \`}\` to close \`{/${name}}\``);
    pos++;
  }

  // --- fragment parsing --------------------------------------------------

  // Parse a run of sibling nodes, stopping (without consuming) at end of input, a `</` closing tag,
  // a `{:` clause, or a `{/` block close. The caller inspects the stop token.
  function parseChildren(): TemplateNode[] {
    const nodes: TemplateNode[] = [];
    while (pos < length) {
      const char = source[pos];
      if (char === "{") {
        const next = source[pos + 1];
        if (next === "#") {
          nodes.push(parseBlock());
          continue;
        }
        if (next === ":" || next === "/") break;
        nodes.push(parseInterpolation());
        continue;
      }
      if (char === "<") {
        const next = source[pos + 1];
        if (next === "/") break;
        if (source.startsWith("<!--", pos)) {
          nodes.push(parseComment());
          continue;
        }
        if (next !== undefined && /[A-Za-z]/.test(next)) {
          nodes.push(parseElement());
          continue;
        }
        // A lone `<` (e.g. `a < b`) — fall through to text.
      }
      nodes.push(parseText());
    }
    return nodes;
  }

  function parseText(): Text {
    const start = pos;
    while (pos < length) {
      const char = source[pos];
      if (char === "{") break;
      if (char === "<") {
        const next = source[pos + 1];
        if (next === "/" || (next !== undefined && /[A-Za-z]/.test(next)) || source.startsWith("<!--", pos)) break;
      }
      pos++;
    }
    return { type: "Text", value: source.slice(start, pos), start, end: pos };
  }

  function parseComment(): Comment {
    const start = pos;
    pos += 4; // `<!--`
    const end = source.indexOf("-->", pos);
    if (end === -1) fail("unclosed comment `<!--`", start);
    const value = source.slice(pos, end);
    pos = end + 3;
    return { type: "Comment", value, start, end: pos };
  }

  // --- interpolations ----------------------------------------------------

  function parseInterpolation(): TemplateNode {
    const start = pos;
    pos++; // `{`
    const raw = readBraceContents();
    const end = pos;
    const trimmed = raw.trim();

    if (/^await[\s(]/.test(trimmed) || trimmed === "await") {
      return { type: "AwaitInterpolation", expression: trimmed.slice(5).trim(), start, end };
    }
    if (trimmed.startsWith("html(")) {
      const inner = htmlCallArgument(trimmed);
      if (inner !== null) {
        return { type: "Html", expression: inner, start, end };
      }
    }
    return { type: "Interpolation", expression: trimmed, start, end };
  }

  // If `expr` is exactly a `html( ... )` call (the matching `)` is the last non-space char), return
  // the raw argument; otherwise null (it is a normal expression that merely begins with `html(`).
  function htmlCallArgument(expr: string): string | null {
    let depth = 0;
    let index = 4; // the `(` in `html(`
    for (; index < expr.length; index++) {
      const char = expr[index];
      if (char === "'" || char === '"' || char === "`") {
        index = skipStringIn(expr, index);
        continue;
      }
      if (char === "(") depth++;
      else if (char === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    if (depth !== 0 || index !== expr.length - 1) return null;
    return expr.slice(5, index).trim();
  }

  // Skip a quoted string / template literal inside a plain JS string, returning the index of its
  // closing delimiter. Used only by htmlCallArgument (a coarse skip, no nested `${}` handling).
  function skipStringIn(text: string, openIndex: number): number {
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

  // --- elements / components / script / style ----------------------------

  function parseElement(): TemplateNode {
    const start = pos;
    pos++; // `<`
    const name = readTagName();
    const lower = name.toLowerCase();
    if (lower === "script") return parseRawText(start, name, true) as Script;
    if (lower === "style") return parseRawText(start, name, false) as Style;

    const attributes = parseAttributes();
    if (pos >= length) fail("unclosed tag", start);

    let selfClosing = false;
    if (source[pos] === "/") {
      selfClosing = true;
      pos++;
    }
    if (source[pos] !== ">") fail(`expected \`>\` to close <${name}>`, start);
    pos++; // `>`

    const isComponent = /[A-Z]/.test(name[0]!);
    const isVoid = !isComponent && VOID_ELEMENTS.has(lower);

    let children: TemplateNode[] = [];
    if (!selfClosing && !isVoid) {
      children = parseChildren();
      if (!(source[pos] === "<" && source[pos + 1] === "/")) fail(`unclosed <${name}>`, start);
      consumeClosingTag(name, start);
    }

    if (isComponent) {
      const node: Component = { type: "Component", name, attributes, children, selfClosing, start, end: pos };
      return node;
    }
    const node: Element = { type: "Element", name, attributes, children, selfClosing, void: isVoid, start, end: pos };
    return node;
  }

  function consumeClosingTag(name: string, openStart: number): void {
    pos += 2; // `</`
    const closeName = readTagName();
    if (closeName !== name) fail(`mismatched closing tag: expected </${name}> but found </${closeName}>`, openStart);
    skipWhitespace();
    if (source[pos] !== ">") fail(`expected \`>\` to close </${name}>`);
    pos++;
  }

  // `<script>` / `<style>` — attributes then a raw body up to the matching `</script>`/`</style>`.
  function parseRawText(start: number, name: string, isScript: boolean): Script | Style {
    const attributes = parseAttributes();
    if (pos >= length) fail(`unclosed <${name}>`, start);

    let selfClosing = false;
    if (source[pos] === "/") {
      selfClosing = true;
      pos++;
    }
    if (source[pos] !== ">") fail(`expected \`>\` to close <${name}>`, start);
    pos++; // `>`

    const contentStart = pos;
    let contentEnd: number;
    if (selfClosing) {
      contentEnd = pos;
    } else {
      const closeRe = isScript ? /<\/script\s*>/gi : /<\/style\s*>/gi;
      closeRe.lastIndex = pos;
      const match = closeRe.exec(source);
      if (match === null) fail(`unclosed <${name}>`, start);
      contentEnd = match.index;
      pos = match.index + match[0].length;
    }
    const content = source.slice(contentStart, contentEnd);

    if (isScript) {
      const module = attributes.some((attr) => attr.type === "StaticAttribute" && attr.name === "module");
      const node: Script = { type: "Script", module, attributes, content, contentStart, contentEnd, start, end: pos };
      return node;
    }
    const node: Style = { type: "Style", attributes, content, contentStart, contentEnd, start, end: pos };
    return node;
  }

  // --- attributes --------------------------------------------------------

  function parseAttributes(): AttributeNode[] {
    const attributes: AttributeNode[] = [];
    while (pos < length) {
      skipWhitespace();
      const char = source[pos];
      if (char === undefined || char === ">" || char === "/") break;
      if (char === "{") {
        attributes.push(parseSpreadAttribute());
        continue;
      }
      attributes.push(parseAttribute());
    }
    return attributes;
  }

  function parseSpreadAttribute(): AttributeNode {
    const start = pos;
    pos++; // `{`
    if (source.startsWith("...", pos)) {
      pos += 3;
      const expression = readBraceContents().trim();
      return { type: "SpreadAttribute", expression, start, end: pos };
    }
    // Shorthand `{name}` → `name={name}` (a convenience beyond the core grammar).
    const expression = readBraceContents().trim();
    return { type: "ExpressionAttribute", name: expression, expression, start, end: pos };
  }

  function parseAttribute(): AttributeNode {
    const start = pos;
    const name = readAttributeName();
    if (name === "") fail("expected an attribute name");

    let valueKind: "none" | "expr" | "static" = "none";
    let expression = "";
    let staticValue: string | null = null;

    skipWhitespace();
    if (source[pos] === "=") {
      pos++;
      skipWhitespace();
      const valueChar = source[pos];
      if (valueChar === "{") {
        pos++;
        expression = readBraceContents().trim();
        valueKind = "expr";
      } else if (valueChar === '"' || valueChar === "'") {
        staticValue = readQuotedValue(valueChar);
        valueKind = "static";
      } else {
        staticValue = readUnquotedValue();
        valueKind = "static";
      }
    }
    const end = pos;

    // Directives.
    if (name.startsWith("bind:")) {
      return { type: "BindDirective", name: name.slice(5), expression: directiveExpression(name, valueKind, expression), start, end };
    }
    if (name.startsWith("class:")) {
      return { type: "ClassDirective", name: name.slice(6), expression: directiveExpression(name, valueKind, expression), start, end };
    }
    if (name.startsWith("style:")) {
      return { type: "StyleDirective", name: name.slice(6), expression: directiveExpression(name, valueKind, expression), start, end };
    }
    // Native event handler: `on<event>={fn}`.
    if (valueKind === "expr" && /^on[a-z]/.test(name)) {
      return { type: "EventAttribute", name, event: name.slice(2), expression, start, end };
    }
    if (valueKind === "expr") {
      return { type: "ExpressionAttribute", name, expression, start, end };
    }
    return { type: "StaticAttribute", name, value: staticValue, start, end };
  }

  // A directive value is `{expr}` or shorthand (none). A static value is invalid there.
  function directiveExpression(name: string, valueKind: "none" | "expr" | "static", expression: string): string | null {
    if (valueKind === "static") fail(`\`${name}\` expects a \`{ ... }\` value`);
    return valueKind === "expr" ? expression : null;
  }

  function readAttributeName(): string {
    const start = pos;
    while (pos < length) {
      const char = source[pos]!;
      if (isWhitespace(source.charCodeAt(pos))) break;
      if (char === "=" || char === ">" || char === "/" || char === "<" || char === "{" || char === '"' || char === "'") break;
      pos++;
    }
    return source.slice(start, pos);
  }

  function readQuotedValue(quote: string): string {
    const start = pos;
    pos++; // opening quote
    const contentStart = pos;
    while (pos < length && source[pos] !== quote) {
      // Skip over a `{ … }` interpolation verbatim so a delimiter quote INSIDE it (`title="{f("x")}"`)
      // doesn't end the value early. scanBalancedUntilBrace already skips strings/template literals.
      if (source[pos] === "{") {
        pos++;
        scanBalancedUntilBrace();
        if (pos < length) pos++; // past the closing `}`
        continue;
      }
      pos++;
    }
    if (pos >= length) fail("unterminated attribute value", start);
    const value = source.slice(contentStart, pos);
    pos++; // closing quote
    return value;
  }

  function readUnquotedValue(): string {
    const start = pos;
    while (pos < length) {
      const char = source[pos]!;
      if (isWhitespace(source.charCodeAt(pos)) || char === ">" || char === "/") break;
      pos++;
    }
    return source.slice(start, pos);
  }

  // --- blocks ------------------------------------------------------------

  function parseBlock(): TemplateNode {
    const start = pos;
    pos += 2; // `{#`
    const keyword = readIdentifier();
    switch (keyword) {
      case "if":
        return parseIfBlock(start);
      case "for":
        return parseForBlock(start);
      case "await":
        return parseAwaitBlock(start);
      case "switch":
        return parseSwitchBlock(start);
      case "try":
        return parseTryBlock(start);
      case "snippet":
        return parseSnippetBlock(start);
      default:
        return fail(`unknown block \`{#${keyword}}\``, start);
    }
  }

  function parseIfBlock(start: number): IfBlock {
    const condition = readBraceContents().trim();
    const branches: IfBranch[] = [];
    let branchStart = start;
    let children = parseChildren();
    branches.push({ condition, children, start: branchStart, end: pos });

    while (atClauseOpen()) {
      branchStart = pos;
      const keyword = consumeClauseKeyword();
      if (keyword !== "else") fail(`unexpected \`{:${keyword}}\` in \`{#if}\``, branchStart);
      skipWhitespace();
      if (matchWord("if")) {
        const elseCondition = readBraceContents().trim();
        children = parseChildren();
        branches.push({ condition: elseCondition, children, start: branchStart, end: pos });
      } else {
        readBraceContents(); // discard whitespace up to `}`
        children = parseChildren();
        branches.push({ condition: null, children, start: branchStart, end: pos });
        break; // `{:else}` is terminal
      }
    }
    consumeBlockClose("if");
    return { type: "IfBlock", branches, start, end: pos };
  }

  function parseForBlock(start: number): ForBlock {
    const header = readBraceContents();
    const parsed = parseForHeader(header, start);
    const children = parseChildren();

    let catchClause: ParamClause | null = null;
    if (atClauseOpen()) {
      const clauseStart = pos;
      const keyword = consumeClauseKeyword();
      if (keyword !== "catch") fail(`unexpected \`{:${keyword}}\` in \`{#for}\``, clauseStart);
      const param = readBraceContents().trim() || null;
      const catchChildren = parseChildren();
      catchClause = { param, children: catchChildren, start: clauseStart, end: pos };
    }
    consumeBlockClose("for");
    return {
      type: "ForBlock",
      await: parsed.await,
      item: parsed.item,
      index: parsed.index,
      iterable: parsed.iterable,
      key: parsed.key,
      children,
      catch: catchClause,
      start,
      end: pos,
    };
  }

  function parseForHeader(header: string, start: number): { await: boolean; item: string; index: string | null; iterable: string; key: string | null } {
    let rest = header.trim();
    let isAwait = false;
    if (/^await\b/.test(rest)) {
      isAwait = true;
      rest = rest.slice(5).trim();
    }
    const ofIndex = topLevelKeyword(rest, "of");
    if (ofIndex === -1) fail("`{#for}` requires `of`", start);
    const left = rest.slice(0, ofIndex).trim();
    let right = rest.slice(ofIndex + 2).trim();

    let item = left;
    let index: string | null = null;
    const commaIndex = topLevelChar(left, ",");
    if (commaIndex !== -1) {
      item = left.slice(0, commaIndex).trim();
      index = left.slice(commaIndex + 1).trim();
    }
    if (item === "") fail("`{#for}` requires an item binding", start);

    let key: string | null = null;
    const byIndex = topLevelKeyword(right, "by");
    if (byIndex !== -1) {
      key = right.slice(byIndex + 2).trim();
      right = right.slice(0, byIndex).trim();
    }
    if (right === "") fail("`{#for}` requires an iterable expression", start);
    return { await: isAwait, item, index, iterable: right, key };
  }

  function parseAwaitBlock(start: number): AwaitBlock {
    const header = readBraceContents().trim();

    // Inline shorthand (Svelte-style): `{#await expr then name}` / `{#await expr catch name}` fold the
    // then/catch binding into the opener, so the block body IS that branch and there is NO pending
    // branch — the compact BLOCKING form of `{#await}` (renders nothing until the read settles, then
    // the value). Desugars to a normal AwaitBlock (empty pending + a then/catch clause), so the plan/
    // emit/check paths are unchanged. `then` wins if both keywords appear (they shouldn't).
    let expression = header;
    let inlineThen: { param: string | null } | null = null;
    let inlineCatch: { param: string | null } | null = null;
    const thenIndex = topLevelKeyword(header, "then");
    const catchIndex = topLevelKeyword(header, "catch");
    if (thenIndex !== -1 && (catchIndex === -1 || thenIndex < catchIndex)) {
      expression = header.slice(0, thenIndex).trim();
      inlineThen = { param: header.slice(thenIndex + "then".length).trim() || null };
    } else if (catchIndex !== -1) {
      expression = header.slice(0, catchIndex).trim();
      inlineCatch = { param: header.slice(catchIndex + "catch".length).trim() || null };
    }
    if (expression === "") fail("`{#await}` requires an expression", start);

    const firstBody = parseChildren();
    let pending: TemplateNode[] = [];
    let thenClause: ParamClause | null = null;
    let catchClause: ParamClause | null = null;
    let finallyClause: Clause | null = null;

    // With an inline clause the first body belongs to that branch (no pending region); otherwise it is
    // the pending content before the first `{:...}` clause.
    if (inlineThen !== null) {
      thenClause = { param: inlineThen.param, children: firstBody, start, end: pos };
    } else if (inlineCatch !== null) {
      catchClause = { param: inlineCatch.param, children: firstBody, start, end: pos };
    } else {
      pending = firstBody;
    }

    while (atClauseOpen()) {
      const clauseStart = pos;
      const keyword = consumeClauseKeyword();
      if (keyword === "then") {
        if (thenClause !== null) fail("`{#await}` already has a `then` branch (from the inline `then` in the opener)", clauseStart);
        const param = readBraceContents().trim() || null;
        thenClause = { param, children: parseChildren(), start: clauseStart, end: pos };
      } else if (keyword === "catch") {
        if (catchClause !== null) fail("`{#await}` already has a `catch` branch (from the inline `catch` in the opener)", clauseStart);
        const param = readBraceContents().trim() || null;
        catchClause = { param, children: parseChildren(), start: clauseStart, end: pos };
      } else if (keyword === "finally") {
        readBraceContents();
        finallyClause = { children: parseChildren(), start: clauseStart, end: pos };
      } else {
        fail(`unexpected \`{:${keyword}}\` in \`{#await}\``, clauseStart);
      }
    }
    consumeBlockClose("await");
    return { type: "AwaitBlock", expression, pending, then: thenClause, catch: catchClause, finally: finallyClause, inline: inlineThen !== null || inlineCatch !== null, start, end: pos };
  }

  function parseSwitchBlock(start: number): SwitchBlock {
    const discriminant = readBraceContents().trim();
    const leading = parseChildren();
    const cases: SwitchCase[] = [];

    while (atClauseOpen()) {
      const clauseStart = pos;
      const keyword = consumeClauseKeyword();
      if (keyword === "case") {
        const test = readBraceContents().trim();
        cases.push({ test, children: parseChildren(), start: clauseStart, end: pos });
      } else if (keyword === "default") {
        readBraceContents();
        cases.push({ test: null, children: parseChildren(), start: clauseStart, end: pos });
      } else {
        fail(`unexpected \`{:${keyword}}\` in \`{#switch}\``, clauseStart);
      }
    }
    consumeBlockClose("switch");
    return { type: "SwitchBlock", discriminant, leading, cases, start, end: pos };
  }

  function parseTryBlock(start: number): TryBlock {
    readBraceContents(); // `{#try}` has no header
    const children = parseChildren();
    let catchClause: ParamClause | null = null;
    let finallyClause: Clause | null = null;

    while (atClauseOpen()) {
      const clauseStart = pos;
      const keyword = consumeClauseKeyword();
      if (keyword === "catch") {
        const param = readBraceContents().trim() || null;
        catchClause = { param, children: parseChildren(), start: clauseStart, end: pos };
      } else if (keyword === "finally") {
        readBraceContents();
        finallyClause = { children: parseChildren(), start: clauseStart, end: pos };
      } else {
        fail(`unexpected \`{:${keyword}}\` in \`{#try}\``, clauseStart);
      }
    }
    consumeBlockClose("try");
    return { type: "TryBlock", children, catch: catchClause, finally: finallyClause, start, end: pos };
  }

  function parseSnippetBlock(start: number): TemplateNode {
    const header = readBraceContents().trim();
    const match = /^([A-Za-z_$][\w$]*)\s*/.exec(header);
    if (match === null) fail("`{#snippet}` requires a name", start);
    const name = match[1]!;
    let params = header.slice(match[0].length).trim();
    if (params.startsWith("(") && params.endsWith(")")) {
      params = params.slice(1, -1).trim();
    } else if (params !== "") {
      fail("`{#snippet}` parameters must be parenthesized", start);
    }
    const children = parseChildren();
    consumeBlockClose("snippet");
    return { type: "SnippetBlock", name, params, children, start, end: pos };
  }

  // --- header helpers ----------------------------------------------------

  // Match a whole word `word` at `pos` (followed by a non-identifier char); consume and return true.
  function matchWord(word: string): boolean {
    if (!source.startsWith(word, pos)) return false;
    const after = source[pos + word.length];
    if (after !== undefined && IDENT_CHAR.test(after)) return false;
    pos += word.length;
    return true;
  }

  // Find a whitespace-delimited keyword at bracket depth 0 within `text`; -1 if absent.
  function topLevelKeyword(text: string, keyword: string): number {
    let depth = 0;
    for (let index = 0; index < text.length; index++) {
      const char = text[index]!;
      if (char === "'" || char === '"' || char === "`") {
        index = skipStringIn(text, index);
        continue;
      }
      if (char === "(" || char === "[" || char === "{") depth++;
      else if (char === ")" || char === "]" || char === "}") depth--;
      else if (
        depth === 0 &&
        text.startsWith(keyword, index) &&
        (index === 0 || /\s/.test(text[index - 1]!)) &&
        /\s/.test(text[index + keyword.length] ?? "")
      ) {
        return index;
      }
    }
    return -1;
  }

  // Find `target` char at bracket depth 0 within `text`; -1 if absent.
  function topLevelChar(text: string, target: string): number {
    let depth = 0;
    for (let index = 0; index < text.length; index++) {
      const char = text[index]!;
      if (char === "'" || char === '"' || char === "`") {
        index = skipStringIn(text, index);
        continue;
      }
      if (char === "(" || char === "[" || char === "{") depth++;
      else if (char === ")" || char === "]" || char === "}") depth--;
      else if (depth === 0 && char === target) return index;
    }
    return -1;
  }

  // --- entry -------------------------------------------------------------

  const children = parseChildren();
  if (pos < length) {
    if (atBlockClose()) fail("unexpected block close with no open block");
    if (atClauseOpen()) fail("unexpected clause with no open block");
    if (source[pos] === "<" && source[pos + 1] === "/") fail("unexpected closing tag");
    fail("unexpected token");
  }

  let moduleScript: Script | null = null;
  let instanceScript: Script | null = null;
  let style: Style | null = null;
  for (const node of children) {
    if (node.type === "Script") {
      if (node.module) moduleScript ??= node;
      else instanceScript ??= node;
    } else if (node.type === "Style") {
      style ??= node;
    }
  }

  return { type: "Root", children, moduleScript, instanceScript, style, start: 0, end: length };
}
