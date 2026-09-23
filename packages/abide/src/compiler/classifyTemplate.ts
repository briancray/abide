import type { Attribute, TemplateNode } from './TemplateNode.ts'

// THE CLASSIFICATION both emitters share. Where a node STANDS is not decided here: `emitMarkup`
// carries a `Cursor`, so the walk that writes a node is the walk that places it. What IS decided
// here is what a node IS — and a decision that must bind BOTH lanes belongs here, because one copy
// of it is the agreement.
//
// THE PREDICATES — `isComponentTag`, `isEventName`, `isHead`, `isSingleRooted`, `isStyleProperty`,
// `isClassToggle`, `isSlot` — and `bindingsOf`. An `onclick` the server declines to write and the
// client binds as a listener is one predicate answering twice.
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

// 32.3 — `name={expr}` IS REACTIVE, which the server half alone cannot make it: it writes the
// value standing at render and nothing ever writes it again.
//
// `write` NAMES WHICH OF THE THREE WRITES THE VALUE GOES TO and `name` what it goes under. One
// binding site with three writes rather than three kinds, because what differs is only the call:
// 32.10 sets one class or one style property, and everything else sets the whole attribute.
type AttributeBinding = {
    attribute: Attribute
    write: 'attribute' | 'class' | 'style'
    // The class, the style property, or the attribute's own name.
    name: string
}

export function isTextish(node: TemplateNode): boolean {
    return node.kind === 'text' || node.kind === 'expression'
}

// 32.24 — whether the run starting at `from` can render as NO NODE AT ALL. Every part is an
// expression, so a value that stringifies to '' writes nothing and the parent holds one fewer
// child than every position after it in that parent assumes. One static character anywhere in the
// run and it cannot happen, which is why this is a property of the RUN rather than of a binding.
//
// ONE COPY, asked by the markup walk, whose positions the build and the mount both read: two copies
// of this rule is two answers to "how many nodes did the parser make here", and that disagreement
// is exactly the defect row construction shipped once already.
export function isBlankRun(nodes: TemplateNode[], from: number): boolean {
    for (let at = from; at < nodes.length; at += 1) {
        const piece = nodes[at] as TemplateNode
        if (!isTextish(piece)) return true
        if (piece.kind === 'text' && piece.text !== '') return false
    }
    return true
}

// WHAT AN ELEMENT BINDS: its listeners, its 32.3 attributes and its 32.9 `bind:element`, read by
// `emitRegion` off the element a cursor placed.
export function bindingsOf(node: TemplateNode & { kind: 'element' }): {
    handlers: { event: string; attribute: Attribute }[]
    attributes: AttributeBinding[]
    elements: Attribute[]
} {
    const bound: ReturnType<typeof bindingsOf> = {
        handlers: [],
        attributes: [],
        elements: [],
    }
    for (const attribute of node.attributes) {
        if (!attribute.expression) continue
        if (isElementBind(attribute.lowerName)) {
            // 32.9 — the node itself. Not written into the tag by the server and not set by the
            // client either: what the value takes is the element.
            bound.elements.push(attribute)
            continue
        }
        if (isEventName(attribute.lowerName)) {
            // 32.4 — a native listener on the element itself, reached by the same walk a text
            // node is, so nothing is added to the document to find it.
            bound.handlers.push({
                event: attribute.lowerName.slice(2),
                attribute,
            })
            continue
        }
        // 32.11's spread is not built, and an emitter that planned one would bind a name beginning
        // `...` as an attribute.
        if (attribute.name.startsWith('...')) continue
        // 32.10, 32.20 — EVERY `style:prop` ON ONE ELEMENT IS ONE `style` ATTRIBUTE and every
        // `class:name` ONE `class`, merged by the server emitter. So a plain `style={expr}` or
        // `class={expr}` standing beside one cannot be written back on its own: `setAttribute`
        // replaces the whole value and takes the directives' halves with it, and the two bindings
        // then overwrite each other in whichever order they re-ran.
        //
        // ALLOWED AND LEFT UNBOUND, rather than refused. The page still RENDERS right — the server
        // writes both halves into the one merged attribute — so the only thing a build error would
        // buy is breaking a page that works today for a clause that is not built. What it costs is
        // the hole: this one attribute keeps the value standing at render where 32.3 says it
        // moves, and nothing reports that.
        //
        // 32.20 IS WHAT CLOSES THE `style` HALF, not a binding here: an interpolated `style`
        // lowers to `style:prop` under a static name and is never built as a string, and then
        // there is no whole-attribute write left to clobber anything. No clause spells the same
        // road for `class`, and until one does the two share this answer rather than each getting
        // its own.
        if (isMergedPlain(node, attribute)) continue
        bound.attributes.push(writeOf(attribute))
    }
    return bound
}

// `onclick={f}` is a listener, never an attribute — the client binds it and the server writes
// nothing for it, so the two emitters have to agree on the test. One copy is that agreement.
// Given the FOLDED name (`Attribute.lowerName`).
// 32.18 — `<Row/>` is a component and `<row/>` is the element. An HTML tag is matched
// case-insensitively everywhere else (`lowerTag`), and this is the one comparison where the
// author's own spelling decides. Here rather than beside the emitter that calls it most, because
// this is what both emitters read and the edge the other way round is a cycle.
export function isComponentTag(tag: string): boolean {
    const first = tag.charCodeAt(0)
    return first >= 65 && first <= 90
}

// 32.19 — `<slot/>` is the position children render into, and it is the one lowercase tag that is
// not an element. Here for `isComponentTag`'s reason: the server writes the caller's markup
// there and the client mounts the caller's bindings there, and a predicate each is the two lanes
// disagreeing about which `<slot>` an author meant.
export function isSlot(node: TemplateNode): boolean {
    return node.kind === 'element' && node.lowerTag === 'slot'
}

// 32.19 — WHETHER THIS FILE HAS A SLOT ANYWHERE IN IT, which is what says its emitted function
// takes the props record: the caller's children arrive on it, and a component whose only prop is
// its own body never calls `props` (33.2) and would otherwise be handed nothing to read them
// from. Over the NODES rather than the plan, because the server emitter reads the template
// directly and never builds one — and one walk answering for both lanes is why it is here.
export function holdsSlot(nodes: TemplateNode[]): boolean {
    for (const node of nodes) {
        if (isSlot(node)) return true
        if (node.kind === 'element' && holdsSlot(node.children)) return true
        if (node.kind === 'block') {
            if (node.block === 'for') {
                if (holdsSlot(node.children)) return true
                continue
            }
            for (const branch of node.branches)
                if (holdsSlot(branch.children)) return true
        }
    }
    return false
}

export function isEventName(lowerName: string): boolean {
    return lowerName.length > 2 && lowerName.startsWith('on')
}

// 32.9 — `bind:element` is the one `bind:` the server writes nothing for and the client does not
// set: it hands the node over. Here for `isEventName`'s reason — the server declining to write
// it and the client binding it are one predicate answering twice.
export function isElementBind(lowerName: string): boolean {
    return lowerName === 'bind:element'
}

// 32.10 — `style:prop` sets ONE style property and `class:name` ONE class. Here rather than beside
// the emitter that writes them out, for `isComponentTag`'s reason: the plan is what both emitters
// read, and an edge from the plan to an emitter is a cycle. The prefix is matched on the FOLDED
// name; the part after it is read from the author's spelling, because a custom property and a
// class are both case-sensitive.
//
// A BARE `style:` OR `class:` IS NOT ONE — the prefix with nothing after it names no property and
// no class, so it stays an ordinary attribute and renders as the author wrote it.
export function isStyleProperty(attribute: Attribute): boolean {
    return (
        attribute.lowerName.length > 6 &&
        attribute.lowerName.startsWith('style:')
    )
}

export function isClassToggle(attribute: Attribute): boolean {
    return (
        attribute.lowerName.length > 6 &&
        attribute.lowerName.startsWith('class:')
    )
}

// Which of the three writes an attribute's value goes to, and under what name — see
// `AttributeBinding`. One function rather than the two predicates plus a slice at each emitter,
// because the prefix's length and the predicate that found it are the same fact twice.
function writeOf(attribute: Attribute): AttributeBinding {
    if (isStyleProperty(attribute))
        return {
            attribute,
            write: 'style',
            name: attribute.name.slice('style:'.length),
        }
    if (isClassToggle(attribute))
        return {
            attribute,
            write: 'class',
            name: attribute.name.slice('class:'.length),
        }
    return { attribute, write: 'attribute', name: attribute.name }
}

// Whether an attribute is the plain `class` or `style` the server MERGED a directive group into —
// the one attribute on an element 32.3 does not move. See where it is asked.
function isMergedPlain(
    node: TemplateNode & { kind: 'element' },
    attribute: Attribute,
): boolean {
    if (attribute.lowerName === 'style')
        return node.attributes.some(isStyleProperty)
    if (attribute.lowerName === 'class')
        return node.attributes.some(isClassToggle)
    return false
}

export function isHead(node: TemplateNode): boolean {
    return node.kind === 'element' && node.lowerTag === 'head'
}

// Whether a `{#for}` body is ONE top-level element and nothing else. That row IS its element, so
// the nodes between the region's anchors are the rows and nothing has to be added to tell them
// apart. `<dt>{k}</dt><dd>{v}</dd>` is not — counting elements there finds four rows in a list of
// two — and that body gets a per-ROW anchor instead.
//
// Formatting whitespace is already gone by here (33.17, 33.18), so a body written across lines is
// still single-rooted.
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

export function isParserOwned(lowerTag: string): boolean {
    return PARSER_OWNED.has(lowerTag)
}
