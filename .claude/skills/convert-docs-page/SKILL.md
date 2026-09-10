---
name: convert-docs-page
description: >
  Convert an abide documentation page from the old one-example shape to the card
  shape — one running example per behaviour the page teaches. Use when asked to
  convert a docs page, work the OLD_SHAPE backlog, apply the card shape, or bring
  a page up to the shape of derive-a-value-from-other-values.
---

# Convert a documentation page to the card shape

An old-shape page embeds one `{% example %}` in its lead and hangs `{% snippet %}`s off it
through six or seven prose sections. A card-shape page embeds one example per behaviour it
teaches, each running, each proving the heading it sits under.

**THE DELIVERABLE IS STRUCTURAL.** Rewriting the prose without moving the structure is the
failure mode, and it is not a hypothetical — it has happened. It passes every check in the repo
except the last step below, because the clauses that govern it are judgement (40.23, 40.24) and
the old examples declare `app: "unconverted"`, which the app check waves through.

## Read first

1. `packages/dogfood/content/values/show-a-value-that-changes.md` and
   `packages/dogfood/content/values/derive-a-value-from-other-values.md`. Both are converted.
   **They are the specification.** Match them.
2. `docs/RULEBOOK.md` clauses 40.23–40.38.
3. `docs/BRAND.md`, "The four apps an example is drawn from" and "What an example has to prove".

Do not restate any of that in the page or in a comment. Cite it or drop it.

## Procedure

1. **Pick the page.** `OLD_SHAPE` in `packages/dogfood/tests/coverage.test.ts` was the backlog and
   IS NOW EMPTY — the conversion is done and the set is a ratchet. So this skill applies to a page
   that arrives in the old shape, whose slug goes into `OLD_SHAPE` first and comes out at step 8.
2. **List the behaviours the page teaches.** One card each (40.23, 40.24). A section making a
   claim with nothing observable behind it — a typing claim, a naming claim — gets prose and no
   card. `## A memo is a Reactive, not a wrapper` is the worked case.
3. **Check `covers` against what the page teaches.** A name the front matter does not claim must
   not get a card; cut it to a sentence and a link. Two cards have been built and thrown away for
   teaching a name their page never claimed.
4. **Pick ONE of BRAND's four apps** for the whole page (40.28, 40.29), and take the situation
   from a pattern that app has rather than inventing one.
5. **Build each card** as its own directory under `packages/dogfood/examples/`:
   `example.json`, `files/` with the `.abide` source shown, and `vanilla/` with the arm that runs.
6. **Write a spec per card** in `packages/dogfood/tests/cards.test.ts`.
7. **Rewrite the page**: lead standalone (40.37), a `## The forms of …` map section if `covers`
   names one registry entry (40.38), then heading → card → prose, per section.
8. **Delete the page's slug from `OLD_SHAPE`.** Never add one back or widen the list.
9. `bun run typecheck && bun run test` from the repo root, green.

## Per card

* The heading is the claim in the reader's words. The card **follows it with nothing in between**
  (40.34) — no introductory paragraph. Everything else goes after the card.
* The summary is the situation and what to press, never a restatement of the heading (40.35).
* The title is the signature and a short gloss.
* **The arm in `vanilla/` is what the frame actually runs.** If it does not hold the invariant the
  card claims, the card contradicts its own prose on screen. A hand-written dependency list or
  entry table in the arm is normal and is the cost the page is pricing.
* The `.abide` source is as short as the proof takes (40.32), with comments of one line or none
  (40.36). A comment long enough to make the argument IS the argument.
* **No counters in the source.** A claim about work is asserted in `cards.test.ts`, not rendered
  (40.25 withdrawn, D45). A count that is domain data — a record's own view count — is fine.
* A control sits with the value it changes (40.30). Tiles for short numbers, `fields` for
  anything longer, `fields stacked` where the label will not fit its column.

## When a card will not land

That is a diagnosis, not a draft (D44). Either the heading names a mechanism where the reader
needed a capability, or the code demonstrates that the name works rather than what it is for.
Rewriting the card repairs neither. Say which one it is and fix that.
