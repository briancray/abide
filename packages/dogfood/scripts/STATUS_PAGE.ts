// THE STATUS PAGE'S BODY, rendered into the same shell every documentation page gets
// — the same brand, the same sidebar, the same reading column — so it is a page of
// this app rather than a document with its own chrome. `buildDocs` composes it, which
// is also what puts the link in the sidebar beside it.
//
// IT IS IN THE SIDEBAR AND NOT IN `NAV`, and 40.45 is the clause. `NAV` is what the
// coverage gates are written over — every content page reachable from it, every
// section showing its opening — and a slug in it with no `content/` file behind it
// would make all of them lie. The link is rendered beside the navigation instead, at
// the foot, under its own heading. D127 reverses the half of D119 that kept it
// reachable only by address.
//
// It holds no results. Every number arrives from an endpoint the reader triggered,
// which is what makes it useful while building: leave it open, hit a button, watch
// rows land one at a time. What is GENERATED is this shell; D119 refused generating a
// page that carried RESULTS, and that refusal still stands.
//
// A leaf — no imports — so nothing about how the app is wired can reach the page that
// reports on it.
export const STATUS_PAGE = `<style>
/* EVERY CLASS HERE IS PREFIXED st-, and one of them cost an afternoon before it was.
   This page shares the docs stylesheet, which carries a rule for the class named row
   setting it to display flex — so a table row carrying that class stopped being a
   table row, every cell became a block, and six columns wrapped to their own widths
   on every line. It rendered as a table with the columns very slightly wrong, which
   is the worst way for a layout bug to present. statusPage.test.ts gates it now. */
/* THE LAYOUT IS THE DOCS' OWN — the brand, the sidebar, the grid — and only the
   COLUMN WIDTH is overridden. 44rem is a measure for prose, and a suite table is six
   columns of counts a reader scans down: at 44rem every file path wrapped to three
   lines and the counts pulled apart from the name they belong to. A table is read
   across, so it gets the width the grid has. */
#content { max-width: none; padding-right: 3.5rem }
/* The sections are children of a plain div, so the column's own gap never reaches
   them. */
#sections { display: flex; flex-direction: column; gap: 2.5rem }
#content > header { display: flex; flex-direction: column; gap: .75rem }
#sections section { display: flex; flex-direction: column; gap: .75rem; margin: 0 }
#sections .head h2 { margin: 0 }
.head { display: flex; align-items: baseline; gap: .75rem; flex-wrap: wrap }
/* THE ACTIONS ARE PUSHED, the heading is not pulled. An auto right margin on the h2
   was the first spelling, and a later rule zeroing every heading's margin — written
   with an id, so more specific — silently cancelled it, leaving the verdict and the
   button clustered against the title. A wrapper that pushes itself cannot be undone
   by a rule about headings. */
.st-actions { margin-left: auto; display: flex; align-items: baseline; gap: .75rem }
/* The command and the count, on the heading line. THE WIDTH HAS TO BE UNDONE: the
   shared stylesheet gives every .ex-note a width of calc(100% - 2rem) and centres it,
   which is right for a note under a table and takes 1024px of a 1056px head here — so
   the title, the note and the actions each got a line of their own. The same family
   of bug as the .row collision, from the other direction: not a name taken, a
   property inherited. */
.st-head-note { margin: 0; width: auto; align-self: baseline }

/* The label rides the bar rather than sitting under it, and THE BAR TAKES THE REST.
   The label is an .ex-note, which the shared stylesheet gives a width of
   calc(100% - 2rem) — harmless on an inline span and not harmless on a flex item,
   which is blockified: the note claimed the column and the bar was squeezed to a
   dash. The same inherited width that put the head on three lines. */
.st-progress { display: flex; align-items: center; gap: .75rem }
.st-progress .st-bar { flex: 1 }
.st-progress .ex-note { flex: none; width: auto; margin: 0; white-space: nowrap }
/* THE HOVER STATE HAS TO BE RESTATED, not only the resting one. The docs stylesheet
   fills every button with the signal teal on hover, and a rule here that set only the
   border let that through — so Cancel, under the cursor, rendered as a dark green
   button with red text. Every property the shared rule sets is set back. */
button { padding: .25rem .625rem; border-radius: 999px; border: 1px solid var(--rule);
  background: var(--raised); color: var(--ink); font: 500 .75rem/1.2 var(--mono) }
button:hover:not(:disabled) { background: var(--raised); color: var(--ink); border-color: var(--muted) }
button:disabled { opacity: .5 }

/* THREE COLOURS AND NO FOURTH. Green means the thing passed or won, red means it
   failed or lost, and everything else is body text — a number with no direction is
   not a muted number, it is a number. The old page rendered every neutral figure in
   \`--muted\`, which made a passing count and a note about the instrument look like
   the same kind of statement. */
.st td, .st th { color: var(--ink) }
.st code { color: inherit; background: none; padding: 0 }
.st-ok { color: var(--good) }
.st-no { color: var(--bad) }

/* FIXED, and the columns are declared. Automatic layout did not lay this table out
   at all: every row sized its first cell to its own file name, so six columns of
   counts stepped right by a different amount on every line and the header sat over
   none of them. A count table is the one place a reader scans DOWN a column, so the
   widths are stated rather than computed. */
.st { width: 100%; border-collapse: collapse; table-layout: fixed;
  font: 400 .8125rem/1.5 var(--sans) }
.st th { text-align: left; font: 500 .6875rem/1 var(--mono); letter-spacing: .04em;
  text-transform: uppercase; padding: 0 .5rem .5rem 0; border-bottom: 1px solid var(--rule) }
.st td { padding: .375rem .5rem .375rem 0; border-bottom: 1px solid var(--rule);
  vertical-align: top }
.st .st-num { text-align: right; width: 6rem; white-space: nowrap; padding-left: 1.25rem;
  font: 400 .8125rem/1.5 var(--mono) }
/* The name column takes what is left, and wrapping anywhere is what keeps a long
   path inside it now that the width is declared rather than grown to fit. A backtick
   in this comment ends the template literal this whole file is, which is how the last
   edit crashed the server with "Expected ; but found overflow". */
.st td:first-child, .st th:first-child { overflow-wrap: anywhere }
/* The package toggles. A count on each, and a red one where that package has a
   failing suite — narrowing the view must never be a way to stop seeing red. */
.st-filters { display: flex; gap: .375rem; flex-wrap: wrap }
.st-filter { padding: .125rem .625rem }
.st-filter span { color: var(--muted); margin-left: .25rem }
.st-filter.st-no span { color: inherit }
.st-filter[aria-pressed="true"],
.st-filter[aria-pressed="true"]:hover { background: var(--ink); color: var(--paper); border-color: var(--ink) }
.st-filter[aria-pressed="true"] span { color: var(--paper); opacity: .7 }

/* The per-row run. Small, on the row, and it stops the row's own toggle — pressing it
   runs that one suite and leaves the other twenty-one results where they are. */
.st-one { padding: .0625rem .5rem; font: 500 .6875rem/1.4 var(--mono) }

/* Cancel takes the position Run had rather than appearing beside it: a control that
   stops what you started is the same control, and one that appears next to it moves
   the thing you were about to click. */
.st-cancel,
.st-cancel:hover:not(:disabled) { color: var(--bad); border-color: var(--bad); background: var(--raised) }
.st tr.st-row { cursor: pointer }
.st tr.st-row:hover td { background: var(--raised) }
.st .st-caret { display: inline-block; width: .75rem; color: var(--muted) }
/* THE TWO ARMS, SIDE BY SIDE. Equal columns, because the point is the comparison and
   a wider one reads as the more important. They stack under about 60rem, where two
   columns of code are two columns of wrapping. */
/* minmax(0, 1fr) AND NOT 1fr. A bare 1fr is minmax(auto, 1fr), so a column cannot
   shrink below its content, and produce is forty lines of long ones — so the abide
   column took more than its half and pushed the hand column off the right edge with
   the overflow rule on the pre unable to help. */
/* Aligned to the start, or the two columns STRETCH to the taller one: produce is
   forty lines and signal is twenty, and the short column carried three hundred
   pixels of empty box under its code. */
.st-arms { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  align-items: start; gap: .75rem 1.5rem; margin-bottom: 1rem }
@media (max-width: 60rem) { .st-arms { grid-template-columns: minmax(0, 1fr) } }
.st-note { margin: 0 0 .25rem; font: 500 .625rem/1 var(--mono); letter-spacing: .08em;
  text-transform: uppercase; color: var(--muted) }
/* A LABEL THAT FOLLOWS A CODE BLOCK NEEDS AIR ABOVE IT. The note carries a bottom
   margin and no top one, which is right for the first label in a column and wrong for
   every one after: LEANING ON sat flush against the block it came after, so the label
   read as part of the code above rather than as the heading of the code below. The
   adjacent-sibling selector is what tells the two cases apart. */
.st-code + .st-note { margin-top: 1rem }
.st-name { text-transform: none; letter-spacing: 0; color: var(--ink) }
.st-code { margin: 0; padding: .5rem .625rem; background: var(--paper);
  border: 1px solid var(--rule); border-radius: 4px; overflow-x: auto;
  font: 400 .75rem/1.5 var(--mono); color: var(--ink) }
.st-code code { background: none; padding: 0; color: inherit; white-space: pre }

/* The playwright project, beside the spec it ran. Two rows share a file name and the
   only thing telling them apart is this. */
.st-project { font: 400 .6875rem/1 var(--mono); color: var(--muted) }

/* The expansion. One nested table, no borders of its own, so the eye reads it as the
   row opening rather than as a second table.

   A CHILD SELECTOR AND NOT A DESCENDANT ONE. The padding here is the expansion's own
   inset, and written as a descendant it also hit every cell of the nested table
   inside it — 8px top and bottom on a 12px line, so the sample read as five widely
   spaced rows of small print. */
.st tr.st-detail > td { background: var(--raised); padding: .5rem .75rem }
.st .st-detail table { width: 100%; border-collapse: collapse; font: 400 .75rem/1.5 var(--sans) }
.st .st-detail td.st-k { width: 14rem; color: var(--muted);
  font: 400 .75rem/1.5 var(--mono); border: 0; padding: .0625rem .75rem .0625rem 0 }
.st .st-detail td.st-v { border: 0; font: 400 .75rem/1.5 var(--mono);
  padding: .0625rem 0 }
.st .st-detail .st-case { display: flex; gap: .5rem; align-items: baseline; padding: .125rem 0 }
.st .st-detail .st-case .st-why { margin-left: auto; font: 400 .6875rem/1.5 var(--mono); color: var(--muted) }
.st-failure { white-space: pre-wrap; font: 400 .75rem/1.5 var(--mono); color: var(--bad); margin: .25rem 0 .5rem }
.st-bar { height: 2px; background: var(--rule); overflow: hidden }
.st-bar i { display: block; height: 100%; width: 0; background: var(--good); transition: width .2s }
</style>
<header>
  <div class="head">
    <h1>Status</h1>
    <span id="overall" class="ex-tag">nothing run yet</span>
    <button type="button" id="all">Run everything</button>
  </div>
  <p class="ex-note" id="where">Every number here is produced when you ask for it. Nothing is authored and nothing is cached. A row with a caret opens; the button on it runs that suite alone.</p>
  <div id="filters"></div>
</header>
<div id="sections"></div>
`
