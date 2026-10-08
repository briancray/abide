import { escapeAttribute, escapeQuote } from '#shared/escapeText.ts'
import { isEventName } from '#shared/isEventName.ts'
import { safeUrl } from '#shared/safeUrl.ts'
import { URL_ATTRIBUTES } from '#shared/URL_ATTRIBUTES.ts'
import { type Attribute, bodiesOf, type TemplateNode } from './TemplateNode.ts'

// THE CLASSIFICATION both emitters share. Where a node STANDS is not decided here: `renderMarkup`
// carries a `Cursor`, so the walk that writes a node is the walk that places it. What IS decided
// here is what a node IS — and a decision that must bind BOTH lanes belongs here, because one copy
// of it is the agreement.
//
// THE PREDICATES — `isComponentTag`, `isSingleRooted`, `isStyleProperty`, `isClassToggle`,
// `isSlot`, and `#shared`'s `isEventName` — and `classifyAttributes`. An `onclick` the server
// declines to write and the client binds as a listener is one classification answering twice.
//
// A TEXT RUN IS THE UNIT, not a slot. Adjacent text nodes MERGE when a browser parses markup, so
// `<p>{label}: {count}</p>` arrives as the single text node `clicks: 0` however it was written.
// Every scheme that lets those two slots be written independently has to put something between
// them — a marker, or a `splitText` — and both change what `childNodes` and `firstChild` answer,
// which a compiler is not allowed to do.
//
// So the run is written WHOLE: one text node, one `data` write, recomputed from all its parts. A
// change to one part rewrites the run, which costs the same single write it would have cost
// anyway plus a string join, and leaves the document identical to the one the author wrote.
// `isTextish` and `isBlankRun` are the run's two questions, asked by the markup walk.

/** Whether a node belongs to a text run: static text or an expression slot. */
export function isTextish(node: TemplateNode): boolean {
    return node.kind === 'text' || node.kind === 'expression'
}

/**
 * Whether the text run starting at `from` can render as no node at all.
 *
 * 32.23 — every part is an expression, so a value that stringifies to '' writes nothing and the
 * parent holds one fewer child than every position after it in that parent assumes. One static
 * character anywhere in the run and it cannot happen, which is why this is a property of the RUN
 * rather than of a binding.
 *
 * ONE COPY, asked by the markup walk, whose positions the build and the mount both read: two copies
 * of this rule is two answers to "how many nodes did the parser make here", and that disagreement
 * is exactly the defect row construction shipped once already.
 */
export function isBlankRun(nodes: TemplateNode[], from: number): boolean {
    for (let at = from; at < nodes.length; at += 1) {
        const piece = nodes[at] as TemplateNode
        if (!isTextish(piece)) return true
        if (piece.kind === 'text' && piece.text !== '') return false
    }
    return true
}

/**
 * One attribute of an element, as every way of making the element reads it.
 *
 * THE ONE CLASSIFICATION. The markup writes the tag from it, a row the browser BUILDS writes it
 * through `setAttribute`, and the mount binds from it — so what an attribute IS, whether it moves
 * (32.3) and whether a URL is written (32.20) are each answered once for all three. A second
 * reading of the attributes is a second answer to "what does this tag say", and a build's copy
 * drifted that way once: it wrote a static `AT&amp;T` as those seven characters where the parser
 * reads the server's bytes as `AT&T`. Every attribute is ONE entry, in the author's order, so each
 * reader writes in the order the tag carries.
 *
 * `live` IS `Lowering.isLive`, asked once: an expression the checker could not prove static.
 */
export type ClassifiedAttribute = {
    attribute: Attribute
    live: boolean
} & // `undefined` for a static URL 32.20 refuses — dropped here, where the value is known. An // The author's own bytes as the tag serves them between the quotes (32.27, 32.28), or
// empty `href` is its own answer and is kept, which `=== ''` would have thrown away.
(
    | { kind: 'static'; bytes: string | undefined }
    // 32.3, 32.37 — a whole value from an expression, which may be absent.
    | { kind: 'dynamic' }
    // 32.11 — a spread's attributes, less the ones the element names itself, kept written by a
    // binding of its own.
    | { kind: 'spread'; explicit: string[] }
    // 32.5, 32.7, 32.8 — the property and the value, kept in step both ways. `reflects` is the
    // attribute the property's value stands at in the tag, and `undefined` where it is not an
    // attribute: a `<textarea>`'s or `<select>`'s value is the client's to set.
    | {
          kind: 'bound'
          bind: ValueBind
          reflects: 'value' | 'checked' | 'open' | undefined
          /** 32.8 — a group member's own `value`, which the group is compared against. */
          own: string
      }
    // 32.9 — the node itself, which a server has none of: written out it was `bind:element=""`,
    // inert and a tell. The client does not set it either; what the value takes is the element.
    | { kind: 'element' }
    // 32.4 — a native listener on the element itself, reached by the same walk a text node is. The
    // server writes nothing, so a handler cannot fire from a document that never hydrated.
    | { kind: 'handler'; event: string }
    // 32.10, 32.19 — a member of a `class` or `style` merge group (`MergeGroup`). `group` is set on
    // the FIRST member only, where the whole group is written, which keeps the tag in the author's
    // attribute order. `toggles` is the one class or style property a directive's binding writes,
    // and `undefined` for the author's own plain attribute — see where that is decided.
    | {
          kind: 'merged'
          group: MergeGroup | undefined
          toggles: { write: 'class' | 'style'; name: string } | undefined
      }
)

/**
 * Every attribute of an element, classified, in the order the tag carries them.
 *
 * `lowering` answers `live` (`Lowering.isLive`).
 */
export function classifyAttributes(
    node: TemplateNode & { kind: 'element' },
    lowering: { isLive(holder: object): boolean },
): ClassifiedAttribute[] {
    const groups = mergeGroupsOf(node)
    const written = new Set<MergeGroup>()
    const classified: ClassifiedAttribute[] = []
    for (const attribute of node.attributes) {
        const live = attribute.expression && lowering.isLive(attribute)
        const group = groups.find((candidate) =>
            candidate.members.has(attribute),
        )
        if (group !== undefined) {
            const leads = !written.has(group)
            written.add(group)
            // 32.10, 32.19 — THE PLAIN `style={expr}` OR `class={expr}` BESIDE A DIRECTIVE IS LEFT
            // UNBOUND. `setAttribute` replaces the whole merged value and takes the directives'
            // halves with it, and the two bindings then overwrite each other in whichever order
            // they re-ran.
            //
            // ALLOWED, rather than refused. The page still RENDERS right — the server writes both
            // halves into the one merged attribute — so the only thing a build error would buy is
            // breaking a page that works today for a clause that is not built. What it costs is
            // the hole: this one attribute keeps the value standing at render where 32.3 says it
            // moves, and nothing reports that.
            //
            // 32.19 IS WHAT CLOSES THE `style` HALF: an interpolated `style` lowers to `style:prop`
            // under a static name and is never built as a string, and then there is no
            // whole-attribute write left to clobber anything. No clause spells the same road for
            // `class`, and until one does the two share this answer.
            classified.push({
                attribute,
                live,
                kind: 'merged',
                group: leads ? group : undefined,
                toggles:
                    attribute === group.plain
                        ? undefined
                        : {
                              write: group.name,
                              name: attribute.name.slice(group.name.length + 1),
                          },
            })
            continue
        }
        if (!attribute.expression) {
            classified.push({
                attribute,
                live,
                kind: 'static',
                bytes: staticBytes(attribute.lowerName, attribute.value),
            })
            continue
        }
        if (attribute.name === '...') {
            classified.push({
                attribute,
                live,
                kind: 'spread',
                explicit: explicitNames(node),
            })
            continue
        }
        const bind = valueBindOf(attribute.lowerName)
        if (bind !== undefined)
            classified.push({
                attribute,
                live,
                kind: 'bound',
                bind,
                reflects:
                    bind === 'value' && node.lowerTag !== 'input'
                        ? undefined
                        : bind === 'group'
                          ? 'checked'
                          : bind,
                own: staticAttribute(node, 'value') ?? 'on',
            })
        else if (isElementBind(attribute.lowerName))
            classified.push({ attribute, live, kind: 'element' })
        else if (isEventName(attribute.lowerName))
            classified.push({
                attribute,
                live,
                kind: 'handler',
                event: attribute.lowerName.slice(2),
            })
        else classified.push({ attribute, live, kind: 'dynamic' })
    }
    return classified
}

/**
 * Whether the mount installs a binding for an attribute.
 *
 * A listener, a bind, a spread and the node handed over always; a value only where it is `live`,
 * because `data-kind={kind}` over a plain `const` is written once by the server and never moves,
 * and a binding for it is a reader woken on every page for nothing.
 */
export function isBound(one: ClassifiedAttribute): boolean {
    if (one.kind === 'static') return false
    if (one.kind === 'dynamic') return one.live
    if (one.kind === 'merged') return one.toggles !== undefined && one.live
    return true
}

/**
 * The bytes between the quotes a static attribute value is served as, or `undefined` for a URL
 * 32.20 refuses.
 *
 * Which is also what a BUILT row decodes (`decodeCharacterReferences`), so the two cannot read one
 * value two ways. 32.27 rewrites only the `"`, which would end the attribute: the value is the
 * author's own source and never a place untrusted data arrives. 32.28 — AN ATTRIBUTE 32.20
 * SCHEME-CHECKS KEEPS THE WHOLE REWRITE, and that one IS a boundary: `safeUrl` reads the bytes, and
 * `&#106;avascript:` is not `javascript:` until a browser decodes the entity — so encoding the `&`
 * is what stops the entity forming at all.
 *
 * `URL_ATTRIBUTES` is keyed by the FOLDED name: compared as written, `<a HREF={u}>` took the
 * ordinary branch with no `safeUrl` around it. A LEAF OF NAMES RATHER THAN FOUR COMPARISONS, because
 * four was not the set: `xlink:href` is how an `<a>` inside `<svg>` spells `href`, and `poster`,
 * `cite`, `ping` and `object`'s `data` are URL-valued by the same HTML rule. The check is name-keyed
 * and tag-blind, which is what makes an inert extra safe, and `srcset` stays OUT because its value is
 * a LIST with descriptors, which the scheme scan would read as one URL and drop whole. `srcdoc` is
 * markup rather than a URL and is guarded by the escaping instead.
 */
function staticBytes(lowerName: string, value: string): string | undefined {
    if (!URL_ATTRIBUTES.has(lowerName)) return escapeQuote(value)
    return safeUrl(value) === value ? escapeAttribute(value) : undefined
}

/**
 * One `class` or `style` merge group on an element: the plain attribute and its directives.
 *
 * 32.10, 32.19 — EVERY `style:prop` ON ONE ELEMENT IS ONE `style` ATTRIBUTE, and every
 * `class:name` is ONE `class`. Written apart they are two attributes of the same name on one tag,
 * and a browser keeps the first: the second is dropped in silence, by the markup rather than by
 * anything the compiler said.
 *
 * THE AUTHOR'S OWN PLAIN `style=` OR `class=` IS A MEMBER OF THE GROUP, not an attribute beside
 * it. `isStyleProperty` answers only for the prefix, so `<div style="color: red"
 * style:width={w}>` wrote TWO `style=` attributes and a browser kept the first — the reactive
 * declaration dropped in silence, which is the loss the merge exists to stop, arriving by the one
 * spelling it did not cover.
 */
export type MergeGroup = {
    /** The attribute the group is written under. */
    name: 'class' | 'style'
    /** Every attribute the group swallows, the plain one included. */
    members: Set<Attribute>
    plain: Attribute | undefined
    directives: Attribute[]
}

// TWO GROUPS, ONE FRAME. What differs between them is the value alone, so the finding and the
// ordering are written once and each way of making an element renders the value its own way.
const MERGED = [
    { name: 'style', is: isStyleProperty },
    { name: 'class', is: isClassToggle },
] as const

/** The element's `style` and `class` merge groups, each only where it has a directive. */
function mergeGroupsOf(node: TemplateNode & { kind: 'element' }): MergeGroup[] {
    const groups: MergeGroup[] = []
    for (const kind of MERGED) {
        const directives = node.attributes.filter(kind.is)
        if (directives.length === 0) continue
        const plain = attributeOf(node, kind.name)
        groups.push({
            name: kind.name,
            members: new Set(
                plain === undefined ? directives : [plain, ...directives],
            ),
            plain,
            directives,
        })
    }
    return groups
}

/** An element's attribute by its folded name, or `undefined`. */
export function attributeOf(
    node: TemplateNode & { kind: 'element' },
    name: string,
): Attribute | undefined {
    for (const attribute of node.attributes)
        if (attribute.lowerName === name) return attribute
    return undefined
}

/** An attribute's static value, or `undefined` where it is absent or an expression. */
function staticAttribute(
    node: TemplateNode & { kind: 'element' },
    name: string,
): string | undefined {
    const attribute = attributeOf(node, name)
    return attribute === undefined || attribute.expression
        ? undefined
        : attribute.value
}

/**
 * Whether a tag names a component: it starts with an uppercase ASCII letter.
 *
 * 32.17 — `<Row/>` is a component and `<row/>` is the element. An HTML tag is matched
 * case-insensitively everywhere else (`lowerTag`), and this is the one comparison where the
 * author's own spelling decides. Here rather than beside the emitter that calls it most, because
 * this is what both emitters read and the edge the other way round is a cycle.
 */
export function isComponentTag(tag: string): boolean {
    const first = tag.charCodeAt(0)
    return first >= 65 && first <= 90
}

/**
 * Whether a node is `<slot/>`, the position a caller's children render into.
 *
 * 32.18 — it is the one lowercase tag that is not an element. Here for `isComponentTag`'s reason:
 * the server writes the caller's markup there and the client mounts the caller's bindings there,
 * and a predicate each is the two lanes disagreeing about which `<slot>` an author meant.
 */
export function isSlot(node: TemplateNode): boolean {
    return node.kind === 'element' && node.lowerTag === 'slot'
}

/**
 * Whether a template has a `<slot/>` anywhere in it.
 *
 * 32.18 — which is what says its emitted function takes the props record: the caller's children
 * arrive on it, and a component whose only prop is its own body never calls `props` (33.2) and
 * would otherwise be handed nothing to read them from. One walk answering for both lanes is why it
 * is here.
 */
export function holdsSlot(nodes: TemplateNode[]): boolean {
    for (const node of nodes) {
        if (isSlot(node)) return true
        for (const body of bodiesOf(node))
            if (holdsSlot(body.children)) return true
    }
    return false
}

/** Whether a block's row, or any of its arms, carries a branch-local `<script>` (14.8). */
export function holdsSetup(node: TemplateNode): boolean {
    for (const body of bodiesOf(node)) if (body.setup !== null) return true
    return false
}

/**
 * Whether a folded attribute name is `bind:element`.
 *
 * 32.9 — the one `bind:` the server writes nothing for and the client does not set: it hands the
 * node over. The server declining to write it and the client binding it are one predicate
 * answering twice.
 */
function isElementBind(lowerName: string): boolean {
    return lowerName === 'bind:element'
}

/**
 * The binds that keep a property and a value in step.
 *
 * 32.5, 32.7, 32.8 — both emitters ask: the server writes the value into the tag and the client
 * binds the property.
 */
type ValueBind = 'value' | 'checked' | 'open' | 'group'

/** The value bind a folded attribute name is, or `undefined` for any other attribute. */
function valueBindOf(lowerName: string): ValueBind | undefined {
    if (lowerName === 'bind:value') return 'value'
    if (lowerName === 'bind:checked') return 'checked'
    if (lowerName === 'bind:open') return 'open'
    if (lowerName === 'bind:group') return 'group'
    return undefined
}

/**
 * Whether an attribute is a `style:prop` directive, setting ONE style property.
 *
 * 32.10 — `style:prop` sets ONE style property and `class:name` ONE class. Here rather than beside
 * the emitter that writes them out, for `isComponentTag`'s reason: this is what both emitters
 * read, and an edge from here to an emitter is a cycle. The prefix is matched on the FOLDED
 * name; the part after it is read from the author's spelling, because a custom property and a
 * class are both case-sensitive.
 *
 * A BARE `style:` OR `class:` IS NOT ONE — the prefix with nothing after it names no property and
 * no class, so it stays an ordinary attribute and renders as the author wrote it.
 */
function isStyleProperty(attribute: Attribute): boolean {
    return (
        attribute.lowerName.length > 6 &&
        attribute.lowerName.startsWith('style:')
    )
}

/** Whether an attribute is a `class:name` directive, toggling ONE class — see `isStyleProperty`. */
function isClassToggle(attribute: Attribute): boolean {
    return (
        attribute.lowerName.length > 6 &&
        attribute.lowerName.startsWith('class:')
    )
}

/**
 * Whether a `{#for}` body is ONE top-level element and nothing else.
 *
 * That row IS its element, so the nodes between the region's anchors are the rows and nothing has
 * to be added to tell them apart. `<dt>{k}</dt><dd>{v}</dd>` is not — counting elements there
 * finds four rows in a list of two — and that body gets a per-ROW anchor instead.
 *
 * Formatting whitespace is already gone by here (33.17, 33.18), so a body written across lines is
 * still single-rooted.
 */
export function isSingleRooted(children: TemplateNode[]): boolean {
    const only = children[0]
    return (
        children.length === 1 &&
        only !== undefined &&
        only.kind === 'element' &&
        // A COMPONENT IS NOT ONE NODE. How many top-level nodes it writes is a fact about another
        // file, so a row that is one invocation carries its own anchor like any multi-root row —
        // without it, `rowsIn` counts the CHILD's elements and finds as many rows as the child
        // has top-level elements.
        !isComponentTag(only.tag)
    )
}

// CONTENT ONLY THE PARSER MAKES RIGHT, which is what a row the browser BUILDS cannot reproduce with
// `createElement` and `appendChild`: an `<svg>` or `<math>` subtree lives in another namespace (and
// the parser fixes the case of `linearGradient`), a raw-text element's contents are not decoded
// the way body text is, and a `<template>`'s children go into its `content`. A row that touches any
// of it is left to the parser — the general path, as the fallback it is.
const PARSER_OWNED = new Set([
    'svg',
    'math',
    'template',
    'script',
    'style',
    'noscript',
    'iframe',
    'xmp',
    'noembed',
    'noframes',
    'plaintext',
])

/** Whether a tag's content is one only the parser makes right (`PARSER_OWNED`). */
export function isParserOwned(lowerTag: string): boolean {
    return PARSER_OWNED.has(lowerTag)
}

/**
 * The key a component's attribute passes a prop under, or `undefined` where it is no prop.
 *
 * 32.6, 32.10 — a `bind:` handing over a `Reactive` keys the name after it, and any other `:` name
 * — `class:`, `style:`, a `bind:` with nothing bound — is an element's own. The build writes the
 * props record by this and the checker projects it by this, so a tag is held to what it sends.
 */
export function propKeyOf(attribute: Attribute): string | undefined {
    if (attribute.lowerName.startsWith('bind:'))
        return attribute.expression
            ? attribute.name.slice('bind:'.length)
            : undefined
    return attribute.name.includes(':') ? undefined : attribute.name
}

/**
 * The attribute names an element writes for itself, which a spread on it does not override.
 *
 * 32.11 — each attribute as the tag carries it, `class:` and `style:` folded into the one attribute
 * they merge into and a bind into the property's own name.
 */
function explicitNames(node: TemplateNode & { kind: 'element' }): string[] {
    const names: string[] = []
    for (const attribute of node.attributes) {
        if (attribute.name === '...') continue
        const lower = attribute.lowerName
        const name = lower.startsWith('class:')
            ? 'class'
            : lower.startsWith('style:')
              ? 'style'
              : lower === 'bind:group'
                ? 'checked'
                : lower.startsWith('bind:')
                  ? lower.slice('bind:'.length)
                  : lower
        if (!names.includes(name)) names.push(name)
    }
    return names
}
