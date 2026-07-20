// `.abide` TEMPLATE PLAN (Stage 1, PR3) — BUILD/SERVER-SIDE ONLY.
//
// The single shared walk over a parsed `Root` that decides comment anchors ONCE, so the emitted
// client and server modules can never drift. It records, per template boundary (the root and each
// block/component/snippet body):
//   • `skeletonClient` — static HTML with comment anchors (`<!---->` for interp/await/html leaves,
//     paired `<!--[-->…<!--]-->` for blocks/components). Cloned + cursor-walked by emitted client code.
//   • `slots` — the dynamic wiring points, each with a `path: number[]` of child-index steps from the
//     cloned fragment root (firstChild + nextSibling walk) and an already-rewritten `expr`.
//   • `serverChunks` — an ordered static-text ⨉ dynamic-slot tree the server emitter concatenates.
//   • `scopeAttr` / `scopedCss` — #13 root scoped styles.
//
// Every embedded expression is rewritten via `rewriteCellRefs` (cells → `.read()/.write()`) then
// `rewriteFreeIdentifiers` (free/block-bound names → `$scope.x`), so both emitters consume ready-to-
// embed source. This module uses the TS7 scanner (through analyzeScope) and NEVER ships to the browser.

import type { AttributeNode, Root, TemplateNode } from "./ast.ts";
import type { ScopeAnalysis } from "./analyzeScope.ts";
import { rewriteCellRefs, rewriteFreeIdentifiers } from "./analyzeScope.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SlotKind =
  | "interpolation"
  | "html"
  | "await"
  | "attr"
  | "event"
  | "class"
  | "style"
  | "bind"
  | "spread"
  | "if"
  | "for"
  | "awaitBlock"
  | "switch"
  | "try"
  | "component"
  | "snippet";

// The tag name of a DYNAMIC element (one with its own dynamic attrs or dynamic descendants), keyed by
// its child-index `path` within the template level. Threaded to the client emitter so the hydrate walk
// can emit a cheap `claimElement($node, tag)` assertion at each such element (PR6, decision 5).
export interface ElementTag {
  path: number[];
  tag: string;
}

// A client sub-plan: its own cloned template + slots (used for a block/component/snippet body).
export interface ClientPlan {
  skeleton: string;
  slots: DynamicSlot[];
  elementTags?: ElementTag[];
}

export interface DynamicSlot {
  kind: SlotKind;
  path: number[]; // child-index path to the target (element for attrs; anchor for leaves/blocks)
  expr: string | null; // primary rewritten expression
  // Leaf slots only (interp/html/await): the UTF-16 length of the immediately-preceding static text
  // node (0 when the previous sibling is a comment/element/block/none). Threaded to `claimText` so
  // hydration can split the server's merged `static+value` text node at the right offset (plan §1).
  prefixLen?: number;
  meta: SlotMeta;
}

// Kind-specific slot payloads (loosely a bag; documented per kind).
export interface SlotMeta {
  name?: string; // attr / class / style / bind / component name
  event?: string; // event name (without `on`)
  attrs?: AttrPlan[]; // component props
  branches?: BranchPlan[]; // if / switch
  discriminant?: string; // switch
  leading?: ClientPlan; // switch leading nodes
  pending?: ClientPlan; // await block
  then?: ClausePlan | null;
  catch?: ClausePlan | null;
  finally?: ClientPlan | null;
  body?: ClientPlan; // component children / try / snippet
  hasChildren?: boolean; // component
  await?: boolean; // for
  item?: string; // for item pattern
  index?: string | null; // for index name
  iterable?: string; // for iterable (rewritten)
  key?: string | null; // for key (rewritten)
  params?: string; // snippet params
}

export interface BranchPlan {
  expr: string | null; // condition / case test (rewritten); null = else/default
  plan: ClientPlan;
}

export interface ClausePlan {
  param: string | null;
  plan: ClientPlan;
}

// An element/component attribute, classified with rewritten expressions.
export type AttrPlan =
  | { kind: "static"; name: string; value: string | null }
  | { kind: "expr"; name: string; expr: string }
  | { kind: "event"; name: string; event: string; expr: string }
  | { kind: "class"; name: string; expr: string }
  | { kind: "style"; name: string; expr: string }
  | { kind: "bind"; name: string; expr: string }
  | { kind: "spread"; expr: string };

// A server chunk tree node.
export type ServerChunk =
  | { kind: "static"; text: string }
  | { kind: "interp"; expr: string }
  | { kind: "html"; expr: string }
  | { kind: "await"; expr: string }
  | { kind: "element"; name: string; void: boolean; attrs: AttrPlan[]; children: ServerChunk[]; scopeAttr: string | null }
  | { kind: "component"; name: string; attrs: AttrPlan[]; children: ServerChunk[]; hasChildren: boolean }
  | { kind: "if"; branches: { expr: string | null; children: ServerChunk[] }[] }
  | {
      kind: "for";
      await: boolean;
      item: string;
      index: string | null;
      iterable: string;
      children: ServerChunk[];
      catch: { param: string | null; children: ServerChunk[] } | null;
    }
  | {
      kind: "awaitBlock";
      expr: string;
      pending: ServerChunk[];
      then: { param: string | null; children: ServerChunk[] } | null;
      catch: { param: string | null; children: ServerChunk[] } | null;
      finally: ServerChunk[] | null;
      // Inline shorthand `{#await p then v}` blocks; the full `{#await}{:then}` block streams (SSR).
      inline: boolean;
    }
  | { kind: "switch"; discriminant: string; cases: { expr: string | null; children: ServerChunk[] }[] }
  | {
      kind: "try";
      children: ServerChunk[];
      catch: { param: string | null; children: ServerChunk[] } | null;
      finally: ServerChunk[] | null;
    }
  | { kind: "snippet"; name: string; params: string; children: ServerChunk[] }
  | { kind: "style"; css: string };

export interface TemplatePlan {
  skeletonClient: string;
  slots: DynamicSlot[];
  serverChunks: ServerChunk[];
  scopeAttr: string | null;
  scopedCss: string | null;
  elementTags: ElementTag[];
}

// ---------------------------------------------------------------------------
// HTML escaping (attribute values baked into the client skeleton)
// ---------------------------------------------------------------------------

const ATTR_ESCAPE: Record<string, string> = { "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" };
function escapeAttr(value: string): string {
  return value.replace(/[&"<>]/g, (char) => ATTR_ESCAPE[char]!);
}

// ---------------------------------------------------------------------------
// #13 scoped styles
// ---------------------------------------------------------------------------

// Small deterministic FNV-1a hash → hex, for the scope attribute suffix.
function hashSource(source: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < source.length; i++) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

// Append the scope attribute selector to each top-level selector of a CSS block. Best-effort (Stage 1
// root scope): rewrites the selector list before each `{`, skipping at-rules and keyframe stops.
export function scopeStyles(css: string, scopeAttr: string): string {
  const selector = `[${scopeAttr}]`;
  let out = "";
  let index = 0;
  while (index < css.length) {
    const braceAt = css.indexOf("{", index);
    if (braceAt === -1) {
      out += css.slice(index);
      break;
    }
    const prelude = css.slice(index, braceAt);
    const trimmed = prelude.trim();
    if (trimmed.startsWith("@")) {
      // At-rule (media/keyframes/etc.) — leave the prelude untouched.
      out += prelude + "{";
    } else {
      const scoped = prelude
        .split(",")
        .map((part) => {
          const t = part.trim();
          return t === "" ? part : part.replace(t, t + selector);
        })
        .join(",");
      out += scoped + "{";
    }
    index = braceAt + 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// The shared walk
// ---------------------------------------------------------------------------

interface WalkContext {
  cellNames: Set<string>;
  declared: Set<string>;
  scopeAttr: string | null;
}

interface LevelResult {
  skeleton: string;
  slots: DynamicSlot[];
  server: ServerChunk[];
  elementTags: ElementTag[];
}

function rewriteExpr(ctx: WalkContext, expr: string): string {
  const cellRewritten = rewriteCellRefs(expr, ctx.cellNames);
  return rewriteFreeIdentifiers(cellRewritten, ctx.declared, "$scope");
}

// One piece of a quoted attribute value: a literal run or a `{expr}` interpolation.
type AttrPart = { literal: string } | { expr: string };

// Skip a JS string / template literal at `s[i]` (its opening quote), returning the index just past
// the closing quote. Honours backslash escapes; template-literal `${…}` recurses through the balanced
// brace scan so a `}` inside an embedded expression doesn't end the string early.
function skipAttrString(s: string, i: number): number {
  const quote = s[i]!;
  i++;
  while (i < s.length) {
    const c = s[i]!;
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (quote === "`" && c === "$" && s[i + 1] === "{") {
      i = scanBalancedBrace(s, i + 2) + 1;
      continue;
    }
    if (c === quote) return i + 1;
    i++;
  }
  return i;
}

// From `start` (just inside a `{`), scan to the matching top-level `}` and return its index. Balanced
// over (), [], {} and skips strings/template literals — mirrors the parser's scanBalancedUntilBrace.
function scanBalancedBrace(s: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < s.length) {
    const c = s[i]!;
    if (c === "'" || c === '"' || c === "`") {
      i = skipAttrString(s, i);
      continue;
    }
    if (c === "(" || c === "[" || c === "{") {
      depth++;
      i++;
      continue;
    }
    if (c === ")" || c === "]") {
      depth--;
      i++;
      continue;
    }
    if (c === "}") {
      if (depth === 0) return i;
      depth--;
      i++;
      continue;
    }
    i++;
  }
  return i;
}

// Split a quoted attribute value into literal + `{expr}` interpolation parts, or null when it has no
// interpolation (pure static). Mirrors element-content interpolation: `{` starts an expression; a
// literal brace is written `{'{'}` (or, in `html()` text, an HTML entity).
function splitAttrValue(value: string): AttrPart[] | null {
  if (!value.includes("{")) return null;
  const parts: AttrPart[] = [];
  let i = 0;
  let literalStart = 0;
  while (i < value.length) {
    if (value[i] === "{") {
      if (i > literalStart) parts.push({ literal: value.slice(literalStart, i) });
      const exprStart = i + 1;
      const close = scanBalancedBrace(value, exprStart);
      parts.push({ expr: value.slice(exprStart, close).trim() });
      i = close + 1;
      literalStart = i;
    } else {
      i++;
    }
  }
  if (literalStart < value.length) parts.push({ literal: value.slice(literalStart) });
  return parts;
}

function planAttribute(ctx: WalkContext, attr: AttributeNode): AttrPlan {
  switch (attr.type) {
    case "StaticAttribute": {
      // A quoted attribute value may carry `{expr}` interpolations (`title="Count: {n}"`), including
      // on a component prop. Compile it to a reactive `expr` attribute that concatenates the parts;
      // a value that is exactly `{expr}` is identical to `name={expr}`. No interpolation → static.
      const parts = attr.value === null ? null : splitAttrValue(attr.value);
      if (parts !== null && parts.some((part) => "expr" in part)) {
        if (parts.length === 1 && "expr" in parts[0]!) {
          return { kind: "expr", name: attr.name, expr: rewriteExpr(ctx, parts[0].expr) };
        }
        const pieces = parts.map((part) =>
          "literal" in part ? JSON.stringify(part.literal) : `(${rewriteExpr(ctx, part.expr)})`,
        );
        return { kind: "expr", name: attr.name, expr: `"" + ${pieces.join(" + ")}` };
      }
      return { kind: "static", name: attr.name, value: attr.value };
    }
    case "ExpressionAttribute":
      return { kind: "expr", name: attr.name, expr: rewriteExpr(ctx, attr.expression) };
    case "EventAttribute":
      return { kind: "event", name: attr.name, event: attr.event, expr: rewriteExpr(ctx, attr.expression) };
    case "ClassDirective":
      return { kind: "class", name: attr.name, expr: rewriteExpr(ctx, attr.expression ?? attr.name) };
    case "StyleDirective":
      return { kind: "style", name: attr.name, expr: rewriteExpr(ctx, attr.expression ?? attr.name) };
    case "BindDirective": {
      const boundRaw = (attr.expression ?? attr.name).trim();
      // A bare state var — `bind:value={count}` over `let count = state(...)` — used to be a
      // documented known-limit (TODO #14): `rewriteExpr` collapses `count` to a READ (`count.read()`),
      // so the two-way bind received the VALUE, not a writable accessor, and silently no-op'd. Wrap a
      // bare cell in the same `{ get, set }` accessor the manual workaround uses, so value/checked/group
      // binds sync both ways. `count` is a declared lexical cell in the emitted mount/render, so it needs
      // no `$scope`/cell-ref rewrite. `bind:element` over a bare cell (`let node = state(null)`) needs the
      // SAME wrap (TODO #22): otherwise the cell collapses to `node.read()` and the node ref is never
      // assigned — `bindElement` writes the element through the `set`. An attach FN (`bind:element={fn}`)
      // is not a cell name, so it falls through to `rewriteExpr` and stays a callable.
      if (ctx.cellNames.has(boundRaw)) {
        return { kind: "bind", name: attr.name, expr: `{ get: () => ${boundRaw}.read(), set: ($v) => ${boundRaw}.write($v) }` };
      }
      return { kind: "bind", name: attr.name, expr: rewriteExpr(ctx, attr.expression ?? attr.name) };
    }
    case "SpreadAttribute":
      return { kind: "spread", expr: rewriteExpr(ctx, attr.expression) };
  }
}

// Static attribute string (client skeleton) for an element's static attrs + optional scope attr.
function staticAttrString(attrs: AttrPlan[], scopeAttr: string | null): string {
  let out = "";
  for (const attr of attrs) {
    if (attr.kind !== "static") continue;
    if (attr.value === null) out += ` ${attr.name}`;
    else out += ` ${attr.name}="${escapeAttr(attr.value)}"`;
  }
  if (scopeAttr !== null) out += ` ${scopeAttr}`;
  return out;
}

function toClientPlan(result: LevelResult): ClientPlan {
  return { skeleton: result.skeleton, slots: result.slots, elementTags: result.elementTags };
}

function walkLevel(ctx: WalkContext, nodes: TemplateNode[]): LevelResult {
  let skeleton = "";
  const slots: DynamicSlot[] = [];
  const server: ServerChunk[] = [];
  const elementTags: ElementTag[] = [];
  let childIndex = 0;
  // Whether the position at `childIndex - 1` is a still-"open" static Text node that a subsequent
  // Text emission would MERGE into. The HTML parser coalesces adjacent character data, so two static
  // text runs separated only by a zero-DOM node (a `{#snippet}` definition, a `<script>`, or an empty
  // Text) become ONE DOM text node — the model must count them as one child too, or every later
  // sibling index desyncs from the parsed server DOM (and the cloned skeleton). `textRun` accumulates
  // that merged run's UTF-16 length so a following leaf's `prefixLen` splits the server's
  // `static+value` node at the right offset.
  let openText = false;
  let textRun = 0;

  const pushLeaf = (kind: SlotKind, expr: string): void => {
    const prefixLen = openText ? textRun : 0;
    skeleton += "<!---->";
    slots.push({ kind, path: [childIndex], expr, prefixLen, meta: {} });
    childIndex++;
  };

  for (const node of nodes) {
    switch (node.type) {
      case "Script":
        break; // handled by scope analysis, emits nothing
      case "Text": {
        if (node.value === "") break;
        skeleton += node.value;
        server.push({ kind: "static", text: node.value });
        // A fresh run claims a new child slot; a run contiguous with the previous text (openText)
        // merges into the same parsed DOM node, so it does NOT advance `childIndex`.
        if (!openText) {
          childIndex++;
          openText = true;
          textRun = 0;
        }
        textRun += node.value.length;
        break;
      }
      case "Comment": {
        const text = `<!--${node.value}-->`;
        skeleton += text;
        server.push({ kind: "static", text });
        childIndex++;
        break;
      }
      case "Interpolation": {
        // TODO #7: `{children()}` is the layout/component single slot. Emit it as a zero-prop, no-body
        // COMPONENT invocation of a `children` component (resolved off `$scope.children`) rather than a
        // text leaf — so it reuses the existing component emit + `$rt.component` runtime path (paired
        // block anchors + claimBlock hydration). The composer injects `children` into scope as an
        // isomorphic component wrapping the next level (server: renders it → Raw; client: mounts it).
        if (node.expression.trim() === "children()") {
          skeleton += "<!--[--><!--]-->";
          const emptyBody = walkLevel(ctx, []);
          slots.push({
            kind: "component",
            path: [childIndex + 1],
            expr: null,
            meta: { name: "children", attrs: [], body: toClientPlan(emptyBody), hasChildren: false },
          });
          server.push({ kind: "component", name: "children", attrs: [], children: [], hasChildren: false });
          childIndex += 2;
          break;
        }
        const expr = rewriteExpr(ctx, node.expression);
        pushLeaf("interpolation", expr);
        server.push({ kind: "interp", expr });
        break;
      }
      case "Html": {
        const expr = rewriteExpr(ctx, node.expression);
        pushLeaf("html", expr);
        server.push({ kind: "html", expr });
        break;
      }
      case "AwaitInterpolation": {
        const expr = rewriteExpr(ctx, node.expression);
        pushLeaf("await", expr);
        server.push({ kind: "await", expr });
        break;
      }
      case "Element": {
        const attrPlans = node.attributes.map((attr) => planAttribute(ctx, attr));
        skeleton += `<${node.name}${staticAttrString(attrPlans, ctx.scopeAttr)}>`;
        const elemPath = [childIndex];
        for (const ap of attrPlans) {
          if (ap.kind === "static") continue;
          if (ap.kind === "spread") slots.push({ kind: "spread", path: elemPath, expr: ap.expr, meta: {} });
          else if (ap.kind === "event")
            slots.push({ kind: "event", path: elemPath, expr: ap.expr, meta: { event: ap.event, name: ap.name } });
          else slots.push({ kind: attrKindToSlot(ap.kind), path: elemPath, expr: ap.expr, meta: { name: ap.name } });
        }
        let childServer: ServerChunk[] = [];
        // Dynamic iff it has a non-static attr/directive of its own or any dynamic descendant slot.
        let isDynamic = attrPlans.some((ap) => ap.kind !== "static");
        if (!node.void) {
          const sub = walkLevel(ctx, node.children);
          skeleton += sub.skeleton;
          for (const s of sub.slots) slots.push({ ...s, path: [childIndex, ...s.path] });
          for (const et of sub.elementTags) elementTags.push({ path: [childIndex, ...et.path], tag: et.tag });
          if (sub.slots.length > 0) isDynamic = true;
          childServer = sub.server;
          skeleton += `</${node.name}>`;
        }
        if (isDynamic) elementTags.push({ path: [childIndex], tag: node.name });
        // #20: carry the #13 scope attribute so the SERVER emitter stamps it on the element too (the
        // client skeleton bakes it via staticAttrString). Without this the server render omits it, so a
        // scoped selector `.a[data-ab-<hash>]` matches nothing during SSR/no-JS and after hydration.
        server.push({ kind: "element", name: node.name, void: node.void, attrs: attrPlans, children: childServer, scopeAttr: ctx.scopeAttr });
        childIndex++;
        break;
      }
      case "Component": {
        skeleton += "<!--[--><!--]-->";
        const attrPlans = node.attributes.map((attr) => planAttribute(ctx, attr));
        const sub = walkLevel(ctx, node.children);
        const hasChildren = node.children.some((n) => n.type !== "Script" && n.type !== "SnippetBlock");
        slots.push({
          kind: "component",
          path: [childIndex + 1],
          expr: null,
          meta: { name: node.name, attrs: attrPlans, body: toClientPlan(sub), hasChildren },
        });
        server.push({ kind: "component", name: node.name, attrs: attrPlans, children: sub.server, hasChildren });
        childIndex += 2;
        break;
      }
      case "IfBlock": {
        skeleton += "<!--[--><!--]-->";
        const branches = node.branches.map((b) => {
          const sub = walkLevel(ctx, b.children);
          return { expr: b.condition === null ? null : rewriteExpr(ctx, b.condition), sub };
        });
        slots.push({
          kind: "if",
          path: [childIndex + 1],
          expr: null,
          meta: { branches: branches.map((b) => ({ expr: b.expr, plan: toClientPlan(b.sub) })) },
        });
        server.push({ kind: "if", branches: branches.map((b) => ({ expr: b.expr, children: b.sub.server })) });
        childIndex += 2;
        break;
      }
      case "ForBlock": {
        skeleton += "<!--[--><!--]-->";
        const bodySub = walkLevel(ctx, node.children);
        const catchSub = node.catch ? walkLevel(ctx, node.catch.children) : null;
        const iterable = rewriteExpr(ctx, node.iterable);
        const key = node.key === null ? null : rewriteExpr(ctx, node.key);
        slots.push({
          kind: "for",
          path: [childIndex + 1],
          expr: iterable,
          meta: {
            await: node.await,
            item: node.item,
            index: node.index,
            iterable,
            key,
            body: toClientPlan(bodySub),
            catch: catchSub ? { param: node.catch!.param, plan: toClientPlan(catchSub) } : null,
          },
        });
        server.push({
          kind: "for",
          await: node.await,
          item: node.item,
          index: node.index,
          iterable,
          children: bodySub.server,
          catch: catchSub ? { param: node.catch!.param, children: catchSub.server } : null,
        });
        childIndex += 2;
        break;
      }
      case "AwaitBlock": {
        skeleton += "<!--[--><!--]-->";
        const expr = rewriteExpr(ctx, node.expression);
        const pendingSub = walkLevel(ctx, node.pending);
        const thenSub = node.then ? walkLevel(ctx, node.then.children) : null;
        const catchSub = node.catch ? walkLevel(ctx, node.catch.children) : null;
        const finallySub = node.finally ? walkLevel(ctx, node.finally.children) : null;
        slots.push({
          kind: "awaitBlock",
          path: [childIndex + 1],
          expr,
          meta: {
            pending: toClientPlan(pendingSub),
            then: thenSub ? { param: node.then!.param, plan: toClientPlan(thenSub) } : null,
            catch: catchSub ? { param: node.catch!.param, plan: toClientPlan(catchSub) } : null,
            finally: finallySub ? toClientPlan(finallySub) : null,
          },
        });
        server.push({
          kind: "awaitBlock",
          expr,
          pending: pendingSub.server,
          then: thenSub ? { param: node.then!.param, children: thenSub.server } : null,
          catch: catchSub ? { param: node.catch!.param, children: catchSub.server } : null,
          finally: finallySub ? finallySub.server : null,
          inline: node.inline,
        });
        childIndex += 2;
        break;
      }
      case "SwitchBlock": {
        skeleton += "<!--[--><!--]-->";
        const discriminant = rewriteExpr(ctx, node.discriminant);
        const leadingSub = walkLevel(ctx, node.leading);
        const cases = node.cases.map((c) => {
          const sub = walkLevel(ctx, c.children);
          return { expr: c.test === null ? null : rewriteExpr(ctx, c.test), sub };
        });
        slots.push({
          kind: "switch",
          path: [childIndex + 1],
          expr: discriminant,
          meta: {
            discriminant,
            leading: toClientPlan(leadingSub),
            branches: cases.map((c) => ({ expr: c.expr, plan: toClientPlan(c.sub) })),
          },
        });
        server.push({
          kind: "switch",
          discriminant,
          cases: cases.map((c) => ({ expr: c.expr, children: c.sub.server })),
        });
        childIndex += 2;
        break;
      }
      case "TryBlock": {
        skeleton += "<!--[--><!--]-->";
        const bodySub = walkLevel(ctx, node.children);
        const catchSub = node.catch ? walkLevel(ctx, node.catch.children) : null;
        const finallySub = node.finally ? walkLevel(ctx, node.finally.children) : null;
        slots.push({
          kind: "try",
          path: [childIndex + 1],
          expr: null,
          meta: {
            body: toClientPlan(bodySub),
            catch: catchSub ? { param: node.catch!.param, plan: toClientPlan(catchSub) } : null,
            finally: finallySub ? toClientPlan(finallySub) : null,
          },
        });
        server.push({
          kind: "try",
          children: bodySub.server,
          catch: catchSub ? { param: node.catch!.param, children: catchSub.server } : null,
          finally: finallySub ? finallySub.server : null,
        });
        childIndex += 2;
        break;
      }
      case "SnippetBlock": {
        // Snippet definitions emit no DOM at their site; they register a builder callable on the scope.
        const sub = walkLevel(ctx, node.children);
        slots.push({
          kind: "snippet",
          path: [],
          expr: null,
          meta: { name: node.name, params: node.params, body: toClientPlan(sub) },
        });
        server.push({ kind: "snippet", name: node.name, params: node.params, children: sub.server });
        break;
      }
      case "Style": {
        const css = ctx.scopeAttr !== null ? scopeStyles(node.content, ctx.scopeAttr) : node.content;
        skeleton += `<style>${css}</style>`;
        server.push({ kind: "style", css });
        childIndex++;
        break;
      }
    }
    // Any node that emitted a DOM boundary (element, comment, leaf/block anchor, style) terminates the
    // open text run. `Text` manages `openText` itself; `Script`/`SnippetBlock` emit no DOM and must
    // leave it intact so the text runs on either side of them merge (matching the parser).
    if (node.type !== "Text" && node.type !== "Script" && node.type !== "SnippetBlock") {
      openText = false;
      textRun = 0;
    }
  }

  return { skeleton, slots, server, elementTags };
}

function attrKindToSlot(kind: "expr" | "class" | "style" | "bind"): SlotKind {
  if (kind === "expr") return "attr";
  return kind;
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

export function buildPlan(root: Root, analysis: ScopeAnalysis): TemplatePlan {
  const scopeAttr = root.style ? `data-ab-${hashSource(root.style.content)}` : null;
  const scopedCss = root.style ? scopeStyles(root.style.content, scopeAttr!) : null;
  const ctx: WalkContext = { cellNames: analysis.cellNames, declared: analysis.declared, scopeAttr };
  const level = walkLevel(ctx, root.children);
  return {
    skeletonClient: level.skeleton,
    slots: level.slots,
    serverChunks: level.server,
    scopeAttr,
    scopedCss,
    elementTags: level.elementTags,
  };
}
