// What a RUNG earns for free — the claims that need no author to write them.
//
// A rung is already a subject: `Example` is a source and a mountable view, which is everything a
// prover needs. So the three claims below are made about EVERY mountable rung in the repo rather than
// about a hand-written list, and they are the three that cost nothing per rung to state:
//
//   builds        the view mounts on a client without throwing
//   isomorphic    what the client builds is what the server wrote
//   adopts        hydrating over that markup BUILDS nothing and REWRITES nothing
//
// The third claim is four zeros rather than one total, and the difference is what a first pass at
// this got wrong: `total()` counts a listener, and a listener is work adoption HAS to do — markup
// cannot carry one. Anchor comments are the same, and a list makes one of its own. So the honest
// contract is not "one node": it is that no element is created, nothing is removed, and no text or
// attribute is written. Those four are a REBUILD; anchors and listeners are the price of taking
// ownership. Asserting the total instead reported twenty-one of twenty-four documented examples as
// broken while the framework's own hydration suite was green — which is the tell that the arm was
// wrong, not the repo.
//
// TWO facts about a rung bend this, and they are independent even though one rung has both. WHEN the
// two arms can be compared: a rung whose content arrives is not built four microtask turns in, so the
// arm sampled an empty list against a full one and called the framework wrong. And WHETHER adoption
// may remove: a `{#for await}` that nothing seeds is drained by the server and re-run from the top
// here, so its rows are dropped by design — while a suspending region arrives just as late and adopts
// perfectly. Folding the two into one flag turns every `{#if x.pending()}` rung red, which is how they
// were told apart.
//
// None of them is new. `#shared/demos/hydrate.ts` already makes all three about a list of template SHAPES;
// what is new is the subject. A shape list is chosen by whoever wrote it and a ladder is chosen by
// what the framework actually documents, so this covers the surface rather than a sample of it.
//
// A rung whose load has NO ENDPOINT behind it must declare that load in `<script module>`, and the
// reason is worth stating because the obvious two mechanisms are both the wrong place to look.
//
// It is not `component()`: `render` below calls the compiled view directly, so there is no part
// holding an instance. Three calls into three containers are three instances, and that is correct —
// instance identity is the POSITION, or two `<Counter/>` on a page would share a count.
//
// It is not the seed either, which is what carries a server-settled answer to a cold client for real
// (SPEC, "Seeding"). The seed is keyed by an endpoint's ADDRESS, and these rungs fake their loads
// with `setTimeout` because what they demonstrate is `invalidate` / `refresh` / `ttl` rather than
// fetching. Nothing addresses them, so nothing seeds them — here or in a browser.
//
// So module scope is the only thing left that makes the two arms agree: it hoists the memo out of
// per-call scope, and `renderToString` and `mount` then read one slot instead of two. Per-instance
// setup gives each its own cold one, they disagree on `pending()`, and the rung goes red — four
// ladders did, while `bun test` and `typecheck` stayed green. Sync rungs are free to use either.
//
// A `Case` rather than a bespoke runner, and that is the whole reason this file is short: the queue,
// the status, the log lines and the failure handling are the harness's already, and a rung's proofs
// therefore paint on `/docs` through the same machinery a case paints with on `/tests`. It also means
// the counters stay honest — `enqueue` runs one case at a time because `harness/measure` is global.

import type { TemplateResult } from 'abide'
import { renderToString } from 'abide/server/internal'
import { hydrate, mount } from 'abide/ui'
import { type Case, container, type Example, sleep } from 'harness'
import { install, measure, nonZero, tick } from 'harness/measure'

// The counters are what two of the three claims are made of. Idempotent, so a page that already
// installed them — every `/tests` page — pays nothing for this import.
install()

/** Markers are the server's business, not the markup's. Both sides are compared without them. */
const strip = (markup: string): string => markup.replace(/<!--[^>]*-->/g, '')

/** How often an arriving arm is sampled, and how long it must hold still to count as settled. */
const SAMPLE_EVERY_MS = 100
const HOLDS_STILL_MS = 400
/** The bound that turns a rung which never settles into a RED rather than a hang. */
const SETTLES_WITHIN_MS = 5_000

/**
 * The markup once it MATCHES, else once it has stopped changing.
 *
 * The target short-circuits, and stillness is the fallback rather than the rule — which is what keeps
 * this a check and not a wait. A rung that arrives correct returns on its first sample, so the common
 * case pays one tick instead of the four `HOLDS_STILL_MS` would take; a rung that arrives at the WRONG
 * markup never matches, holds still, and is returned for the caller to compare and go red on.
 *
 * `HOLDS_STILL_MS` is the margin over the widest gap a rung streams on — 60 ms, in
 * `template/24-rows-as-they-arrive.abide` — because a gap read as stillness is a sample taken
 * mid-stream, which is the flake this is here to remove rather than to relocate.
 */
async function settles(host: HTMLElement, target: string): Promise<string> {
    let held = strip(host.innerHTML)
    let still = 0
    for (let waited = 0; held !== target && waited < SETTLES_WITHIN_MS && still < HOLDS_STILL_MS; waited += SAMPLE_EVERY_MS) {
        await sleep(SAMPLE_EVERY_MS)
        const now = strip(host.innerHTML)
        still = now === held ? still + SAMPLE_EVERY_MS : 0
        held = now
    }
    return held
}

/**
 * The one rung shape the server DRAINS and this side re-runs from the top.
 *
 * `{#for await}` with nothing seeding it is the single documented exception to "nothing removed": the
 * adopt path cannot know how far the server got, so it drops the drained rows rather than adopting
 * them — `ChildPart.adopt`'s `Streamed` arm, and SPEC's "Known limits".
 *
 * Read off the rung's own SOURCE, and the reason is that BOTH ways of being wrong are loud rather than
 * that it saves a field: a rung whose prose merely quotes the spelling inverts the assertion and goes
 * red, and a stream reached through an imported child misses the regex and fails "nothing removed, 0".
 * Neither can pass while hiding something, which is what the alternatives have to beat — `Example`
 * already carries declared per-rung facts (`of`, `spells`, `client`) cross-checked by `docs.test.ts`, so
 * a flag there would be gated too, and `isStreamed` beside `isKeyed` would be the same fact the code
 * under test branches on.
 *
 * NOT the same question as whether a rung settles late. A suspending region — `/docs/memo`'s third
 * rung, and every other `{#if x.pending()}` — arrives after the same four microtask turns and adopts
 * perfectly, which is what caught a first pass at this that folded the two into one flag.
 */
const DRAINS_A_STREAM = /\{#for\s+await\b/

/**
 * One case per rung, built once.
 *
 * A slot calls `proofsOf` on every pass, and a `Case` rebuilt per pass is a fresh identity handed to a
 * prop cell — which wakes the component's watch on every render for a value that never changed. Keyed
 * on the rung itself so nothing has to name it, and weak so a ladder that is navigated away from is
 * collectable.
 */
const BUILT = new WeakMap<Example, Case | null>()

/**
 * The proofs for one rung, or `null` when there is nothing to prove.
 *
 * `null` is nearly unreachable now and is kept for the one rung it is still about: `Example.view` is
 * optional, and `dogfood/test/docs.test.ts` requires one on every rung a reader can reach except
 * `template`'s prop-written-back, whose cell belongs to a parent it has none of. A case that passed by
 * doing nothing would be the wrong answer there.
 *
 * WHAT THE THREE CLAIMS MEAN FOR A RUNG THAT FETCHES. The seam-crossing rungs mount a browser half
 * that calls a real endpoint, and both arms below render it — `renderToString` here has no request
 * scope and `mount` has no server. Neither is a problem, and the reason is a rule those rungs keep
 * rather than luck: the result is behind a BUTTON, so the markup this compares is the idle one.
 */
export function proofsOf(rung: Example): Case | null {
    const held = BUILT.get(rung)
    if (held !== undefined) return held
    const built = build(rung)
    BUILT.set(rung, built)
    return built
}

function build(rung: Example): Case | null {
    const view = rung.view
    if (view === undefined) return null
    const render = (): TemplateResult => view({})

    return {
        title: rung.adds,
        note:
            'Claimed for every rung that renders, with nothing written per rung: the client builds ' +
            'what the server wrote, and hydrating over it builds nothing and rewrites nothing. A ' +
            'rebuild produces the same screen at full cost, so the counts are the claim and the ' +
            'output cannot show it. Anchors and listeners are not a rebuild — markup cannot carry a ' +
            'listener, so adoption has to attach one.',
        async run({ is, log }) {
            // A call site is PARSED once and that cost belongs to the template cache, not to
            // adoption — see `served()` in `#shared/demos/hydrate.ts`, which warms it for the same reason.
            const warm = document.createElement('div')
            mount(warm, render).dispose()

            const served = container()
            served.innerHTML = await renderToString(render(), { hydratable: true })

            const built = container()
            const live = mount(built, render)
            await tick()
            const wrote = strip(served.innerHTML)

            // Four microtask turns is the whole of the wait for a rung that renders in one pass, which
            // is most of them, and it is the wrong INSTANT for one whose content arrives: the server
            // arm is `renderToString` awaited to the end while this one is still an empty `<ul>`. Same
            // template, same intent, two sampling times — the disagreement was in this file. It read as
            // a FLAKE rather than a red only because the browser sweep took the status mid-run.
            //
            // `settles` takes the target, so a rung that already agrees returns without waiting and
            // nothing synchronous pays for the arriving ones.
            is('the client builds what the server wrote', await settles(built, wrote), wrote)
            live.dispose()
            built.remove()

            const work = measure(() => void hydrate(served, render))
            log('work to adopt', nonZero(work))
            // The four that mean REBUILT. A client that threw the markup away produces exactly the
            // same screen, so nothing about the output can tell you it happened.
            is('nothing built', work.createElement, 0)
            is('no text rewritten', work.textWrite, 0)
            is('no attribute rewritten', work.setAttribute, 0)
            // The removal is the one with an exception, and `DRAINS_A_STREAM` is it. Asserted rather
            // than skipped in both directions: the day a seed makes a drained stream adopt, this goes
            // red and the spec gets read again.
            if (DRAINS_A_STREAM.test(rung.source)) {
                is('the drained rows are dropped, which is the known limit', work.remove > 0, true)
            } else is('nothing removed', work.remove, 0)
            served.remove()
        },
    }
}
