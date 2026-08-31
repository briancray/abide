# abide

An isomorphic, type-safe framework for reactive async interfaces — for humans and for machines —
built on Bun and web standards.

Same callable, same name, same *intent* on both sides. A reactive value is read and written BY NAME
inside a `.abide` file, and the explicit `x()` / `x.set(v)` spelling keeps compiling: the sugar
is over it, never instead of it.

Status: **shell**. The workspace, seams, checks and measurement lanes are in place; the
framework itself is not written yet. `docs/SPEC.md` is the surface being built toward.

## Layout

    packages/abide      the framework
    packages/harness    the three measurement lanes everything is tested and measured with
    packages/dogfood    the documentation app, and the app abide is dogfooded on

`abide` is split by seam — `#shared`, `#ui`, `#server` — and those seams are what
framework-internal code imports through. An app resolves `abide`, `abide/runtime` and
`abide/server` instead.

`harness` is split by DEPENDENCY, and that is why it is a package rather than a folder:
`harness/measure` has no abide in its graph at all, which is what lets the hand-written arm
of a ratio be timed by the same clock and the same batch sizing as the abide arm.

| lane | answers | substrate |
| --- | --- | --- |
| `harness/measure` | DOM calls, from inside the page | bun **and** browser |
| `harness/engine`  | what Blink did — style, layout, paint, per-layer shares | chromium, over CDP |
| `harness/server`  | bytes, microtask turns, allocations | bun |

## Brand

`docs/BRAND.md` is to the marketing surface what `docs/SPEC.md` is to the code: the claims
that may be made, what each one rests on, the words that name things, and the ones that are
off limits until something is measured. A claim whose supporting row changes is a claim that
goes.

## Documentation

The docs are being written BEFORE the framework, on purpose: a capability that cannot be
explained as a problem an app author has is not ready to be a capability. `packages/dogfood`
holds the prose, and a throwaway static build renders it while `.abide` cannot yet compile.

    bun run docs          render packages/dogfood/content -> packages/dogfood/dist
    bun run docs:serve    the same, and serve it on :4000

`content/**.md` is what you edit; `scripts/` is scaffolding and goes when `abide build` can
serve those pages itself. The information architecture is `scripts/NAV.ts`; a page's `title`,
short `nav` label, `intent`, `covers` claim and `examples` paths live in its own front matter.

MARKDOWN IS THE PAGE and HTML is derived from it. A content link names the `.md`, and the
renderer rewrites it to `.html` on the way out — so a content file is correct read where it
LIES, on GitHub or as a download, and not only after a build. `examples:` names each embedded
example's directory repo-relative for the same reason: an agent reading the markdown alone
knows where the files are without being told how `{% example <name> %}` resolves. `bun test`
gates both — front matter against the directives in the body, every link against the nav.

Every page is downloadable as markdown, and `dist/<slug>.md` is a byte COPY of the content
file rather than a second render, so there is nothing to keep in sync. `dist/abide.md` is the
one GENERATED markdown: every page in nav order with the examples expanded inline, for an
agent that has the file and not the repo. It is built rather than checked in — an agent with
the repo reads `packages/dogfood/content/` directly, which is the whole point of the two
rules above.

The site's stylesheet is `packages/dogfood/src/ui/app.css` — a real file at the address the
app's own `import '#ui/app.css'` resolves to once `.abide` compiles, so the CSS does not move
when the scaffold goes. SPEC's "Script / style blocks" carries that import: global rather than
scoped, folded into the route's content-hashed sheet ahead of the scoped blocks.

An EXAMPLE is a DIRECTORY under `packages/dogfood/examples/`, not a fence, per SPEC's
"Documentation": real files, embedded with `{% example <name> %}`, rendered as one object
with Files / Result / Wire / Compiled / Vanilla / Bench / Tests panels and a Download button that
serves one zip per example, built by `scripts/zip.ts` — STORED entries, no dependency and
no system `zip`, since `Bun.hash.crc32` is the only piece a zip writer otherwise needs.
An example solves ONE stated problem and every file in it contributes to that problem —
a file that demonstrates something else belongs in the example whose problem it is.
Bench and Tests are RESULTS, not source: a reader wants to know whether the example holds,
and the spec itself ships in the zip. The DEFAULT panel set is Files, Result, Bench, Tests; Wire, Compiled and Vanilla appear
only where they prove something about that example's own problem — read-invoice carries
Compiled because the generated client module IS the proof that no server code shipped.
A panel with no artifact is not rendered, so a Wire tab never appears on an example
that makes no request. An example carries no styling it does not need: read-invoice has
no `<style>` block at all, and the Result shows abide's own defaults. A result is a SEQUENCE of `states`, not one snapshot, because a settled snapshot cannot
show a transient — `pending()` is invisible in the finished output. Each state names a
file and a `hold`; opening the Result tab replays from the first, and a Replay button sits
beside the URL where there is more than one state to move between. When the runtime lands, the
replay becomes an actual re-run and the state files go.

File ORDER is derived, not listed: a reader opens the file the problem is solved in,
which is the `.abide` file for almost every problem — the page is where an author
starts and the handler is what they reach back for. So files sort by SEAM
(`.abide`, then browser, then server), and `"about": "server"` flips it for an example
whose problem IS a server one — validating a body, authorising a call. The manifest's
array order only breaks ties within a seam. `example.json` names the files each panel shows. `files/`, `vanilla/` and the downloads are
real; `result.html`, `compiled/`, `wire` and `bench` are checked-in static content that the
compiler and the harness are meant to REPLACE, which is why they are artifacts in the example
directory rather than markup in the renderer.

`bun test` gates that every embedded example exists, that every example directory is
embedded, that every path a manifest names is on disk, and that a page's `examples:` front
matter names exactly the directories its body embeds. The suite roots are enumerated in
the `test` script because an example's own test is an artifact the docs display and cannot run
until the framework exists.

The Overview mirrors the SIDEBAR: one short section per major nav section, each a small
table, a few lines of example, and the links into that section. Adding a nav section without
a matching one there is what makes the home page stop being a map.

There are no horizontal rules anywhere — not the `<hr>` element, and not a border doing
its job on a heading, a footer or a nav group. Spacing and the heading colour carry the
structure instead, and the renderer has no `---` branch, so one cannot come back by accident.
The rules between pages in `dist/abide.md` are the exception that proves it: that file is
plain text an agent reads, not a page, and nothing renders it.

The rail renders on EVERY page, because it carries the markdown downloads. The "on this
page" list inside it, with scroll-spy, appears only where there are two or more `##`
headings — one heading is a repeat of the title. A file is shown by the SPECIFIER an author types — `#server/rpc/invoices.ts`, never the
disk form — so the renderer maps `src/<seam>/` onto `#<seam>/` in every fence label and
file tab. Build output has no seam and is left alone.

A fenced block may carry a LABEL after the language — ```` ```ts src/server/rpc/invoices.ts ```` —
and the label decides the block's spine colour: a path naming `server` is one side, a `.abide`
file is both, anything else is the browser. Which side a snippet runs on is the question these
docs answer most often, so it is shown rather than said.

`bun test` gates the coverage claim: every capability named in a `docs/SPEC.md` table must be
covered by some guide's `covers:` list, nothing may claim a capability the SPEC does not have,
and no content file may be unreachable from the nav.

## Checks

    bun run typecheck     tsc (TypeScript 7, the native port) over all three packages
    bun run test          abide build, then bun test --parallel
    bun run test:serial   the same, unparallelised — re-run a TIMING failure here before believing it
    bun run test:changed  only what a change reaches
    bun run lint          unused locals, imports and parameters
    bun run e2e           playwright, two projects over the one app
    bun run knip          exports and files nothing resolves through
    bun run docs          render the documentation site
    bun run verify        lint, typecheck, test

`verify` is green now. `e2e` is configured but not yet live: it comes online with the
first page the dogfood app serves, since `abide start` has nothing to serve until then.

Run everything from the REPO ROOT: `bunfig.toml`'s DOM preload is resolved relative to it,
and the suites measure a different code path while still passing if it is not found.

## Conventions

`CLAUDE.md` is the working agreement — seams, hot paths, reactive invariants, and how a
performance claim is made. It is worth reading before the first change; in particular, a
performance claim is a RATIO against hand-written code in the same substrate, and a gate is
verified by reverting the fix and watching it fail.
