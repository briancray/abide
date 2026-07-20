// AST node definitions for the `.abide` template parser (M4a).
//
// This is a SYNTAX tree only — expressions inside `{ ... }`, attribute values, block headers,
// and `<script>`/`<style>` bodies are captured as RAW strings (never JS/CSS-parsed). Every node
// carries `start`/`end` byte offsets into the source for later sourcemaps / diagnostics.
//
// The tree is a discriminated union keyed on `type` (nodes) and `type` (attributes). See
// docs/spec/abide-compiler.md (C1–C9) and CLAUDE.md (".abide template grammar") for the grammar.

// A half-open source span [start, end) in UTF-16 code-unit offsets.
export interface Span {
  start: number;
  end: number;
}

// ---------------------------------------------------------------------------
// Attributes / directives (on elements and components)
// ---------------------------------------------------------------------------

// `name="v"`, `name=v`, or bare `name` (boolean). `value` is null for a boolean attribute.
export interface StaticAttribute extends Span {
  type: "StaticAttribute";
  name: string;
  value: string | null;
}

// `name={expr}` — reactive attribute; `expression` is the raw source between the braces.
export interface ExpressionAttribute extends Span {
  type: "ExpressionAttribute";
  name: string;
  expression: string;
}

// `on<event>={fn}` — native DOM handler (e.g. `onclick`, `oninput`). `event` is the name minus `on`.
export interface EventAttribute extends Span {
  type: "EventAttribute";
  name: string;
  event: string;
  expression: string;
}

// `bind:value={cell}`, `bind:checked`, `bind:group`, `bind:element`, `bind:<prop>`, and the derived
// form `bind:value={{ get, set }}`. `name` is the bind target; `expression` is null for the
// shorthand `bind:value` (binds to a same-named cell).
export interface BindDirective extends Span {
  type: "BindDirective";
  name: string;
  expression: string | null;
}

// `class:name={cond}` — reactive class toggle. Shorthand `class:name` → `expression` null.
export interface ClassDirective extends Span {
  type: "ClassDirective";
  name: string;
  expression: string | null;
}

// `style:prop={value}` — reactive single style property. Shorthand `style:prop` → `expression` null.
export interface StyleDirective extends Span {
  type: "StyleDirective";
  name: string;
  expression: string | null;
}

// `{...expr}` spread — props onto a component, attributes onto an element.
export interface SpreadAttribute extends Span {
  type: "SpreadAttribute";
  expression: string;
}

export type AttributeNode =
  | StaticAttribute
  | ExpressionAttribute
  | EventAttribute
  | BindDirective
  | ClassDirective
  | StyleDirective
  | SpreadAttribute;

// ---------------------------------------------------------------------------
// Leaf template nodes
// ---------------------------------------------------------------------------

// Literal text between tags/expressions.
export interface Text extends Span {
  type: "Text";
  value: string;
}

// `<!-- ... -->`
export interface Comment extends Span {
  type: "Comment";
  value: string;
}

// `{expr}` — escaped reactive interpolation. Also covers `{children()}` slot and `{name(args)}`
// snippet calls, which are syntactically ordinary interpolations.
export interface Interpolation extends Span {
  type: "Interpolation";
  expression: string;
}

// `{html(expr)}` — raw (unescaped) HTML injection. `expression` is the argument to `html(...)`.
export interface Html extends Span {
  type: "Html";
  expression: string;
}

// `{await fn()}` — inline await interpolation (blocks SSR until resolved). `expression` is the
// awaited expression (the text after the `await` keyword).
export interface AwaitInterpolation extends Span {
  type: "AwaitInterpolation";
  expression: string;
}

// ---------------------------------------------------------------------------
// Elements / components / raw-text (script, style)
// ---------------------------------------------------------------------------

// Lowercase-tag element, e.g. `<div>`. `void` is true for HTML void elements (`<br>`, `<img>`, …).
export interface Element extends Span {
  type: "Element";
  name: string;
  attributes: AttributeNode[];
  children: TemplateNode[];
  selfClosing: boolean;
  void: boolean;
}

// Capitalized-tag component invocation, e.g. `<Foo>`.
export interface Component extends Span {
  type: "Component";
  name: string;
  attributes: AttributeNode[];
  children: TemplateNode[];
  selfClosing: boolean;
}

// `<script>` (per-instance setup) or `<script module>` (once-per-module). Body captured raw.
export interface Script extends Span {
  type: "Script";
  module: boolean;
  attributes: AttributeNode[];
  content: string;
  contentStart: number;
  contentEnd: number;
}

// `<style>` — component-scoped at root, subtree-scoped when nested. Body captured raw.
export interface Style extends Span {
  type: "Style";
  attributes: AttributeNode[];
  content: string;
  contentStart: number;
  contentEnd: number;
}

// ---------------------------------------------------------------------------
// Control-flow blocks
// ---------------------------------------------------------------------------

// One arm of an `{#if}` chain. `condition` null marks the `{:else}` arm.
export interface IfBranch extends Span {
  condition: string | null;
  children: TemplateNode[];
}

// `{#if cond} … {:else if cond} … {:else} … {/if}`
export interface IfBlock extends Span {
  type: "IfBlock";
  branches: IfBranch[];
}

// A `{:catch e}` / `{:then v}` clause carrying an optional binding param (null = no param).
export interface ParamClause extends Span {
  param: string | null;
  children: TemplateNode[];
}

// A `{:finally}` clause (no binding).
export interface Clause extends Span {
  children: TemplateNode[];
}

// `{#for item, i of list by key} … {/for}` and `{#for await item of source} … {:catch e} … {/for}`.
// `item` is the (possibly destructuring) binding, `index`/`key` optional, `iterable` raw.
export interface ForBlock extends Span {
  type: "ForBlock";
  await: boolean;
  item: string;
  index: string | null;
  iterable: string;
  key: string | null;
  children: TemplateNode[];
  catch: ParamClause | null;
}

// `{#await p} … {:then v} … {:catch e} … {:finally} … {/await}`. `pending` is the content before
// the first clause.
export interface AwaitBlock extends Span {
  type: "AwaitBlock";
  expression: string;
  pending: TemplateNode[];
  then: ParamClause | null;
  catch: ParamClause | null;
  finally: Clause | null;
  // The inline shorthand `{#await p then v}` / `{#await p catch e}` is the compact BLOCKING form (no
  // pending branch — renders nothing until the read settles). The full `{#await}{:then}` block STREAMS
  // (streaming-ssr-plan.md decision 4). Distinguishes them since both desugar to the same shape.
  inline: boolean;
}

// One `{:case v}` (or `{:default}`, `test` null) arm.
export interface SwitchCase extends Span {
  test: string | null;
  children: TemplateNode[];
}

// `{#switch subj} {:case v} … {:default} … {/switch}`. `leading` holds any nodes (usually
// whitespace) between the header and the first case.
export interface SwitchBlock extends Span {
  type: "SwitchBlock";
  discriminant: string;
  leading: TemplateNode[];
  cases: SwitchCase[];
}

// `{#try} … {:catch e} … {:finally} … {/try}` — render/effect error boundary.
export interface TryBlock extends Span {
  type: "TryBlock";
  children: TemplateNode[];
  catch: ParamClause | null;
  finally: Clause | null;
}

// `{#snippet name(args)} … {/snippet}` — reusable builder. `params` is the raw parameter list.
export interface SnippetBlock extends Span {
  type: "SnippetBlock";
  name: string;
  params: string;
  children: TemplateNode[];
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export type TemplateNode =
  | Text
  | Comment
  | Interpolation
  | Html
  | AwaitInterpolation
  | Element
  | Component
  | Script
  | Style
  | IfBlock
  | ForBlock
  | AwaitBlock
  | SwitchBlock
  | TryBlock
  | SnippetBlock;

// The parsed document. `children` is the full ordered node list; the `moduleScript`,
// `instanceScript`, and `style` fields are convenience references to the root-level `<script
// module>`, `<script>`, and `<style>` (null when absent). Nested scripts/styles live inside their
// branch's `children`, not here.
export interface Root extends Span {
  type: "Root";
  children: TemplateNode[];
  moduleScript: Script | null;
  instanceScript: Script | null;
  style: Style | null;
}
