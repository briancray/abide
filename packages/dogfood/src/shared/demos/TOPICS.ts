// The reading order: every public name and every spelling, grouped by what it is ABOUT.
//
// The third file beside `CALLABLES.ts` and `SPELLINGS.ts`, and deliberately the smallest kind of
// addition — A TOPIC OWNS NO RUNGS. It owns an order and a paragraph, and its members are keys into
// the two lists that already exist. So `/docs/<callable>` is still the page a reader arrives at
// holding `cookies`, and nothing about the reference moves to get a sidebar that groups.
//
// It exists because both lists are FLAT, and a flat list of forty-four names is a glossary. `state`
// and `watch` are one idea, `GET` and `socket` are another, and the sidebar said so nowhere: the only
// grouping either list had was the specifier you import from, which is a fact about the SEAM rather
// than about what a name is for. That grouping put `props` eleven rows from `<slot/>`, in a different
// vocabulary, under a different heading.
//
// A TOPIC HOLDS BOTH VOCABULARIES, which is the thing neither list can do alone. `props` is imported
// and `<slot/>` is typed, so they are in different files by construction — and they are one lesson.
// The topic is where they sit next to each other.
//
// IT DERIVES THE TWO ORDERS rather than adding a third list. `CALLABLE_ORDER` and `SPELLING_ORDER`
// were hand-written arrays whose own comments said they existed because alphabetical "reads as a
// glossary" — they were encoding this grouping with the group names left out. They are its flatten
// now, so the sections and the order cannot disagree about where a name goes.
//
// `#tests/unit/docs.test.ts` asserts the membership is a PARTITION, in both directions: a name in no
// topic fails, a name in two fails, and a topic naming something neither list has fails. That is the
// standard the lists themselves are held to, and it is the thing a hand-written `sections` array in a
// layout cannot give — which is exactly where the docs app this shape was taken from had already
// drifted.

import type { CallableName } from './CALLABLES.ts'
import type { SpellingName } from './SPELLINGS.ts'

export interface TopicMeta {
    /** The heading, which is a phrase rather than a slug: "the request scope", not `request-scope`. */
    title: string
    /**
     * The paragraph that places these names among EACH OTHER.
     *
     * The one thing a per-name page structurally cannot say. A `blurb` answers "what is this", and a
     * reader who does not yet know that `memo` is where derivation lives has no name to look that up
     * under — so the lead is where the shape of a group is stated once, above the grid of its members.
     *
     * Required, and gated. An optional lead is a topic with no prose in it six months from now.
     */
    lead: string
    /** This topic's names, in reading order. May be empty: the four blocks are typed, not imported. */
    callables: CallableName[]
    /** This topic's spellings, in reading order. Empty on every topic that is not about the template. */
    spells: SpellingName[]
}

export const TOPICS = {
    reactivity: {
        title: 'reactivity',
        lead:
            'Four ways to hold a value, and two ways to say one is wrong. A `state` keeps only what it ' +
            'OWNS, a `memo` derives or loads, a `channel` takes what arrives over time, and a `watch` is ' +
            'how the graph reaches something that is not in it. Reading IS the subscription in all four — ' +
            'there is no dependency array anywhere, and the set is whatever the last run read.',
        callables: ['state', 'memo', 'channel', 'watch', 'invalidate', 'refresh'],
        spells: [],
    },
    holes: {
        title: 'holes and bindings',
        lead:
            'The hole, and everything a hole is allowed to be. WHERE `{expr}` sits is what it means — ' +
            'content in child position, a whole attribute, one class, one property — and the `bind:` ' +
            'family is that same hole written back. `raw` is on this shelf because it is the one hole ' +
            'that skips the escape, which is a decision about trust rather than about syntax.',
        callables: ['raw'],
        spells: [
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
        ],
    },
    branches: {
        title: 'branches',
        lead:
            'The four blocks, which are the only places a template’s SHAPE depends on a value. Each owns ' +
            'the region between its tags rather than the node it sits on, so a branch can be left and ' +
            're-entered without the nodes around it moving — and `{#for}`’s `by` is what decides whether ' +
            'a reorder moves rows or rebuilds them.',
        callables: [],
        spells: ['if', 'for', 'switch', 'try'],
    },
    components: {
        title: 'components',
        lead:
            'A `.abide` file IS a component, so this is the one shelf holding a name you import and four ' +
            'things you type. What a caller passed is `props`; where a caller’s markup lands is ' +
            '`<slot/>`; and the two `<script>` positions decide whether a value is per-instance or per-' +
            'module, which is the distinction most easily got wrong in a file that renders on both sides.',
        callables: ['props'],
        spells: ['component', 'tag', 'slot', 'script', 'styles'],
    },
    routing: {
        title: 'routing',
        lead:
            'The address, as three callables over one idea. `route()` says which page this URL named and ' +
            'is REACTIVE — four small states, so a same-route move republishes rather than remounting — ' +
            '`navigate` moves without a new caller arriving, and `url` builds the target so that a link ' +
            'and a `navigate` cannot disagree about where they go.',
        callables: ['route', 'navigate', 'url'],
        spells: [],
    },
    transport: {
        title: 'transport',
        lead:
            'The two laws: `rpc` is a memo with a wire under it, and a `socket` is a `channel` whose ' +
            'subscribers arrived over one. The declaration is the same one you would write for the local ' +
            'version and the seam is what the compiler fills in — which is why the method matters here ' +
            'and the call site does not change.',
        callables: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'socket'],
        spells: [],
    },
    responses: {
        title: 'responses',
        lead:
            'What a route answers with when it builds the answer itself rather than returning a value: a ' +
            'body, a status, a location, or many bodies one line at a time. `error` is the odd one and ' +
            'the useful one — THROWN, so it can come from anywhere under the handler, and DECLARED, so it ' +
            'crosses a wire as itself instead of as a 500.',
        callables: ['json', 'page', 'redirect', 'error', 'HttpError', 'jsonl', 'sse', 'render'],
        spells: [],
    },
    request: {
        title: 'the request scope',
        lead:
            'Six ambients scoped to one request, so a helper four frames down reads what it needs without ' +
            'every frame between declaring a parameter to carry it. `bag` is the one you fill and the ' +
            'other five are filled for you — and `bag` is also the property that makes a module-level ' +
            '`memo` per-caller rather than per-process.',
        callables: ['request', 'cookies', 'bag', 'trace', 'nonce', 'csp'],
        spells: [],
    },
    process: {
        title: 'the process',
        lead:
            'What is true of the SERVER rather than of a caller. Boot is an onion rather than a ' +
            'before/after pair — the socket binds inside `onStart`, so an app cannot answer against setup ' +
            'that has not finished — and `middleware` is the one registration that appends rather than ' +
            'replaces, so a rung declared late joins the chain instead of taking it over.',
        callables: ['server', 'middleware', 'onStart', 'onStop', 'onError', 'config', 'onConfig'],
        spells: [],
    },
    account: {
        title: 'what an app says about itself',
        lead:
            'Who this caller is, whether the app is well, whether the network is there at all, and what ' +
            'it wrote down — each asked with the same call on both substrates. Every one has a floor ' +
            'abide fills in and a hook for the app’s own half, so the answer is never null and never ' +
            'guessed by the client.',
        callables: ['log', 'health', 'online', 'identity', 'onHealth', 'onIdentity'],
        spells: [],
    },
} satisfies Record<string, TopicMeta>

export type TopicName = keyof typeof TOPICS

/**
 * The sections, in the order a reader meets them: the graph, then the file it is written in, then the
 * address, then the server — ending with the three questions an app is asked about itself.
 *
 * DERIVED, for the reason the two flattens below are: written out, it was the same ten names in the
 * same order as the record above, and the only thing a second copy can do is disagree with the first.
 * Declaration order is the decision now, so a section moves by moving its entry.
 */
export const TOPIC_ORDER = Object.keys(TOPICS) as TopicName[]

/**
 * Every public name, in reading order — the flatten of the topics.
 *
 * Derived rather than written, which is what makes the sidebar's sections and the index's order the
 * same decision. It was a forty-four-line array here whose comment explained that alphabetical "reads
 * as a glossary"; the grouping it was standing in for is `TOPICS` above.
 */
export const CALLABLE_ORDER: CallableName[] = TOPIC_ORDER.flatMap((topic) => TOPICS[topic].callables)

/** Every spelling, in reading order, by the same flatten. */
export const SPELLING_ORDER: SpellingName[] = TOPIC_ORDER.flatMap((topic) => TOPICS[topic].spells)
