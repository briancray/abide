// What a `.abide` template parses into. Build-time only — nothing here is reached from
// the client's static closure, and none of it is walked per row.

/**
 * One attribute on a template element, with its name folded to lower case once.
 *
 * AN HTML TAG OR ATTRIBUTE NAME IS ASCII CASE-INSENSITIVE, so every comparison reads the `lower`
 * form the parser folded once, and the author's spelling is what the emitters write. Folded at each
 * comparison instead, every site that forgot was its own bug: `<HEAD>` never hoisted, `HREF=`
 * skipped 32.20's check, `ONCLICK=` shipped as a live attribute, `</BR>` was emitted.
 */
export type Attribute = {
    name: string
    lowerName: string
    /**
     * The literal text, or the expression source where `expression` is true.
     *
     * A quoted value with a slot in it is a template literal whose static text is already decoded
     * (32.27, 32.28), and on a component a static value is too (`pushQuoted`).
     */
    value: string
    /**
     * `attr={expr}` rather than `attr="text"`.
     *
     * The field is always present rather than added on the expression path, so the record has one
     * shape.
     */
    expression: boolean
}

/**
 * One arm of a control block.
 *
 * `subject` is the source between the braces — a condition for `{#if}` and `{:else if}`, and EMPTY
 * for `{:else}`, which is what makes it the arm that always takes.
 */
export type Branch = {
    subject: string
    children: TemplateNode[]
    /** 14.8 — the arm's branch-local `<script>`, or `null`. */
    setup: Setup | null
    /** 34.11 — the arm's branch-local `<style>`, or `null`. */
    style: string | null
    /** 32.43 — the inline components the arm declares. */
    components: InlineComponent[]
}

/**
 * A `{#component Name(pattern)}…{/component}` block: its name, its props pattern and the annotation
 * typing it, and a body shaped as a block body is, with the `<script>` and `<style>` written in it.
 *
 * NOT A NODE. It renders nothing where it stands, so it is never pushed into the list it is
 * written in — the text either side of it is one run, as the browser parses it — and it is filed
 * on the body whose scope it is in instead (32.43), or on the invocation it is passed to (32.50).
 */
export type InlineComponent = {
    kind: 'component'
    name: string
    /** Where the name starts in the source. */
    at: number
    /** The props pattern as written, or `''` where the parentheses are empty. */
    pattern: string
    patternAt: number
    /** The pattern's type annotation as written, or `''` where it has none. */
    type: string
    typeAt: number
    children: TemplateNode[]
    setup: Setup | null
    style: string | null
    /** 32.43 — the inline components its own body declares. */
    components: InlineComponent[]
}

/**
 * A branch-local `<script>`: setup run once each time its body is built.
 *
 * 14.8 — a record of its own so the projection and the lowering can key its span apart from the
 * subject's.
 */
export type Setup = { text: string }

/** One node of a parsed `.abide` template: an element, text, an expression slot, or a block. */
export type TemplateNode =
    | {
          kind: 'element'
          tag: string
          lowerTag: string
          attributes: Attribute[]
          children: TemplateNode[]
          /**
           * 32.43 — the inline components declared between an invocation's or a `<slot>`'s tags
           * and inside an element there. An element of any other kind files its own on the body
           * around it, and holds none.
           */
          components: InlineComponent[]
          /** 32.50 — the inline components written directly between an invocation's tags. */
          passed: InlineComponent[]
      }
    | { kind: 'text'; text: string }
    // The source between the braces, verbatim. 32.1 renders it escaped.
    | { kind: 'expression'; source: string }
    // 32.12 — a control block renders ONE branch. A REGION: its shape depends on a value, which
    // makes it the one place a marker earns its bytes. `invariance.spec.ts` is why that marker
    // has to be a comment, and `benchGrid.ts` is why there are none anywhere else.
    | { kind: 'block'; block: 'if'; branches: Branch[] }
    // 32.16 — a render-time boundary over a region. Two arms, the body and the catch, each carrying
    // its own copy of the `{:finally}` markup, which stands either way; `error` is the name the catch
    // binds, `''` where the author bound none.
    | { kind: 'block'; block: 'try'; branches: Branch[]; error: string }
    // 32.13 — repeats its body over a list. A REGION like `{#if}`, and the body is planned once
    // and instantiated per row, so a row's paths are the row's own.
    | {
          kind: 'block'
          block: 'for'
          /** `{#for item, index of list by key}` — `index` and `key` are optional. */
          item: string
          index: string
          subject: string
          key: string
          children: TemplateNode[]
          /** 14.8 — the row's branch-local `<script>`, or `null`. */
          setup: Setup | null
          /** 34.11 — the row's branch-local `<style>`, or `null`. */
          style: string | null
          /** 32.43 — the inline components the row declares. */
          components: InlineComponent[]
      }

/**
 * The node lists one level down: an element's children, a row's body, each arm of a block.
 *
 * Each arm of an `{#if}` or a `{#try}` is its own list, so a walk that only descends is written
 * once over kinds rather than once per kind.
 */
export function childListsOf(node: TemplateNode): TemplateNode[][] {
    // An inline component's body is not one of them (`componentsOf`): it renders where it is
    // invoked, not where it is declared.
    if (node.kind === 'element') return [node.children]
    if (node.kind !== 'block') return []
    if (node.block === 'for') return [node.children]
    return node.branches.map((branch) => branch.children)
}

/**
 * The inline components filed on a node: the ones its bodies declare, and the ones an invocation
 * is passed. What a walk over every body a file writes adds to `childListsOf`.
 */
export function componentsOf(node: TemplateNode): InlineComponent[] {
    if (node.kind === 'element')
        return node.passed.length === 0
            ? node.components
            : [...node.components, ...node.passed]
    if (node.kind !== 'block') return []
    if (node.block === 'for') return node.components
    const components: InlineComponent[] = []
    for (const branch of node.branches) components.push(...branch.components)
    return components
}
