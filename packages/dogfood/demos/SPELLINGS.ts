// Every SPELLING the template language answers to, its one line, and where its rungs are.
//
// The second axis of `/docs`, and it exists because the first one cannot reach the template.
// `CALLABLES.ts` is keyed by a name an author IMPORTS, which is the right key for `cookies` and the
// wrong key for `{#for}`: a block, a `bind:`, a `class:` toggle and a `<slot/>` import nothing, so a
// reader who has met one in a `.abide` file has no name to look up. The whole of the template was
// therefore reachable only through `/tests/template`, which is a page about whether it WORKS.
//
// Same shape as `CALLABLES.ts` for the same reasons: prose plus the ladders to look in, no static
// import of a rung, so `/docs` draws every entry without pulling one ladder.
//
// NOTHING HERE IMPORTS THE COMPILER. The closed sets this list is checked against — `BRANCHES` and
// `BINDABLE` — are read in `test/docs.test.ts` and nowhere else, because `abide/compiler` pulls
// TypeScript's scanner and a page that imported it would ship ~700 kB of it. That is the same split
// `SUITES.ts` was made for.
//
// The gate is in two strengths, because the language is:
//
//   CLOSED    `{#if}` `{#for}` `{#switch}` `{#try}` `{#component}` and the five `bind:` targets are
//             enumerable, so `test/docs.test.ts` compares this list against the compiler's own tables
//             in both directions. A sixth block is a red gate until it has a rung.
//   OPEN      `class:x`, `style:p`, `{...spread}` and `on<event>` take any name there is, so there is
//             no set to compare against and the gate is that the page has a rung at all.

import type { Example } from 'harness'
import { claimed, type LadderName } from './LADDERS.ts'

export interface SpellingMeta {
    /**
     * The route segment: `bind` → `/docs/syntax/bind`.
     *
     * A slug and not the spelling, because `{#if}` and `bind:value` are not paths. It is also what a
     * rung's `spells` carries, so the two cannot drift into two names for one page.
     */
    slug: string
    /** How it is TYPED in a file, which is what a reader arrived with: `{#for}`, `bind:`, `<slot/>`. */
    name: string
    /**
     * Whether the compiler owns a closed set for this one, and therefore which gate applies.
     *
     * `block` is checked against `BRANCHES` and `bind` against `BINDABLE` — one page per member of the
     * set, both directions, so a sixth block or a sixth target is a red gate until it has a page and a
     * rung. `open` says the spelling takes any name there is and only owes a rung. Written down rather
     * than inferred from the slug so that adding a page cannot quietly choose itself the weakest check.
     */
    gate: 'block' | 'bind' | 'open'
    /** The one line under the spelling, on the index and on the page. */
    blurb: string
    /** The ladders holding this spelling's rungs. Hand-written, and checked both ways like `CALLABLES`. */
    ladders: LadderName[]
}

export const SPELLINGS = {
    // --- the hole, and what each position does with it ---------------------------
    expression: {
        slug: 'expression',
        name: '{expr}',
        gate: 'open',
        blurb:
            'The hole. WHERE it sits is what it means — content in child position, a whole attribute ' +
            'value inside a tag — and it escapes wherever it lands.',
        ladders: ['template'],
    },
    events: {
        slug: 'events',
        name: 'on<event>={fn}',
        gate: 'open',
        blurb:
            'A native listener on an ELEMENT. On a COMPONENT the same spelling is an ordinary prop ' +
            'called `onclick`, which is the one thing about it worth knowing.',
        ladders: ['template'],
    },
    class: {
        slug: 'class',
        name: 'class:name={cond}',
        gate: 'open',
        blurb: 'Toggle ONE class. Not a string being rewritten — the rest of the attribute is never touched.',
        ladders: ['template'],
    },
    style: {
        slug: 'style',
        name: 'style:prop={value}',
        gate: 'open',
        blurb: 'Set one style property, by the same rule as `class:` and with the same refusal on a component.',
        ladders: ['template'],
    },
    spread: {
        slug: 'spread',
        name: '{...expr}',
        gate: 'open',
        blurb:
            'Props on a component, attributes on an element — and on a component the key set is fixed ' +
            'at setup, so a key the spread ADDS later is reported rather than dropped.',
        ladders: ['template'],
    },
    // --- the binds, one page per TARGET -------------------------------------------
    // Five pages and not one, because the target is what a reader arrived with: somebody who met
    // `bind:checked` is looking up `bind:checked`, and a single page titled `bind:value` claiming to
    // cover it is the same mistake as a suite page keyed by capability. They are also five different
    // contracts — a property, a boolean attribute, a membership, a disclosure, a node — sharing only
    // the direction the traffic runs. What they DO share is stated on each rather than centralised:
    // the table in `BINDABLE` is what makes a pairing with no event to write back from a compile error.
    'bind-value': {
        slug: 'bind-value',
        name: 'bind:value',
        gate: 'bind',
        blurb:
            'Two-way on the value of an input, textarea or select: the property is set from the cell, ' +
            'and the cell from the event that says the user changed it. A `{get, set}` pair stands in ' +
            'for the cell where the two directions are not one value.',
        ladders: ['template'],
    },
    'bind-checked': {
        slug: 'bind-checked',
        name: 'bind:checked',
        gate: 'bind',
        blurb:
            'A BOOLEAN property mirrored as a boolean attribute — so `false` is the attribute being ' +
            'absent rather than the string — written back from `change`.',
        ladders: ['template'],
    },
    'bind-group': {
        slug: 'bind-group',
        name: 'bind:group',
        gate: 'bind',
        blurb:
            'Membership rather than a value: each input is compared against its OWN `value`, which is ' +
            'why the element needs one and is a compile error without it. Checkboxes hold the checked ' +
            'ones in a list; radios are exclusive, so the cell holds the single value that matched.',
        ladders: ['template'],
    },
    'bind-open': {
        slug: 'bind-open',
        name: 'bind:open',
        gate: 'bind',
        blurb:
            'A `<details>`, written back from `toggle`. The attribute half is what earns it over a ' +
            'handler: a row open on the server arrives open in the markup rather than snapping open after.',
        ladders: ['template'],
    },
    'bind-element': {
        slug: 'bind-element',
        name: 'bind:element',
        gate: 'bind',
        blurb:
            'The NODE itself, and therefore the one target with no row in the table and no event: there ' +
            'is no property to read and nothing to write back from, so it is legal on any element — and ' +
            'client-only, since a server render has no node to hand over. Two shapes take it: a CELL, ' +
            'which is handed the node through `set`, and a FUNCTION, called with the node once per ' +
            'instance and whose return is the teardown.',
        ladders: ['template'],
    },

    // --- the blocks ---------------------------------------------------------------
    if: {
        slug: 'if',
        name: '{#if}',
        gate: 'block',
        blurb:
            'A branch, its `{:else if}` and its `{:else}` — and the three-arm shape a probe picks an ' +
            'arm from, where a FAILURE needs an arm of its own or the `{:else}` falls into a read that throws.',
        ladders: ['template'],
    },
    for: {
        slug: 'for',
        name: '{#for}',
        gate: 'block',
        blurb:
            'A list, its index, and `by` — the KEY, which is a spelling the compiler translates rather ' +
            'than a function to import. `{#for await}` is the same block over something still arriving.',
        ladders: ['template'],
    },
    switch: {
        slug: 'switch',
        name: '{#switch}',
        gate: 'block',
        blurb: 'One expression against many arms — `{:case v}` and `{:default}` — instead of a chain of `{:else if}`.',
        ladders: ['template'],
    },
    try: {
        slug: 'try',
        name: '{#try}',
        gate: 'block',
        blurb:
            'An error boundary with JavaScript semantics, and therefore SYNCHRONOUS: the body is one ' +
            'unit so `{:catch}` can see a throw, and a pending read is not one.',
        ladders: ['template'],
    },
    component: {
        slug: 'component',
        name: '{#component}',
        gate: 'block',
        blurb:
            'A reusable builder written inline, invoked as `<Name/>` and passable as a value. It has no ' +
            '`<script>`, so there is no setup to run once and nothing to keep.',
        ladders: ['template'],
    },

    // --- the tags an author writes rather than the browser's -----------------------
    tag: {
        slug: 'tag',
        name: '<Name/>',
        gate: 'open',
        blurb:
            'A capitalised tag is a component, CARRIED to the position that shows it rather than called ' +
            'where it stands — which is what makes setup run once and a prop that did not move wake nobody. ' +
            'What it names is a VALUE, so a cell can hold one and the tag re-mounts when it changes.',
        ladders: ['template'],
    },
    slot: {
        slug: 'slot',
        name: '<slot/>',
        gate: 'open',
        blurb: 'Where a component renders what was written between its tags. Nothing declares it, and every component takes it.',
        ladders: ['template'],
    },
    script: {
        slug: 'script',
        name: '<script>',
        gate: 'open',
        blurb:
            'Setup, per instance. `<script module>` is module scope and the only one that may `export`; ' +
            'a NESTED one is branch-local, and in a `{#for}` that means per row.',
        ladders: ['template'],
    },
    styles: {
        slug: 'styles',
        name: '<style>',
        gate: 'open',
        blurb:
            'Component-scoped CSS: every element carries the scope and every selector requires it, so a ' +
            'rule cannot reach out. A nested one scopes a SUBTREE.',
        ladders: ['template'],
    },
} satisfies Record<string, SpellingMeta>

export type SpellingName = keyof typeof SPELLINGS

/**
 * The index order, which is the order a reader would meet these in rather than the alphabet.
 *
 * The hole first, because every other row is a place to put one; then the directives that decorate a
 * tag; then the blocks; then the tags an author writes. Written out for the reason `CALLABLE_ORDER`
 * is: sorted, `bind` leads and `tag` trails, and that is a glossary.
 */
export const SPELLING_ORDER: SpellingName[] = [
    'expression',
    'events',
    'class',
    'style',
    'spread',
    'bind-value',
    'bind-checked',
    'bind-group',
    'bind-open',
    'bind-element',
    'if',
    'for',
    'switch',
    'try',
    'component',
    'tag',
    'slot',
    'script',
    'styles',
]

/** One spelling's rungs, in ladder order — the same walk `rungsOf` makes, against the other claim. */
export async function rungsSpelling(spelling: SpellingMeta): Promise<Example[]> {
    return claimed(spelling.ladders, (rung) => rung.spells, spelling.slug)
}
