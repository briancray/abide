// THE STATUS PAGE, served rather than written. It used to be generated into `dist`
// and that could not hold: `buildDocs` starts from an EMPTY `dist`, so every docs
// build deleted the page, including the one `docs:serve` runs on its way to serving
// it. A page the server owns has no such ordering to get right.
//
// It holds no results. Every number on it arrives from an endpoint the reader
// triggered, which is also what makes it useful while building: leave it open, hit a
// button, watch the run land. See docs/DECISIONS.md D119.
//
// A leaf — no imports — so nothing about how the harness is wired can reach the page
// that reports on it.
export const STATUS_PAGE = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Status — abide</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;600&family=Space+Grotesk:wght@600;700&display=swap">
<link rel="stylesheet" href="/docs.css">
<style>
body { max-width: 64rem; margin: 0 auto; padding: 3rem 1.5rem 6rem; display: flex; flex-direction: column; gap: 2.5rem }
h1, h2 { margin: 0 }
header { display: flex; flex-direction: column; gap: .75rem }
section { display: flex; flex-direction: column; gap: .75rem }
.head { display: flex; align-items: baseline; gap: .75rem; flex-wrap: wrap }
.head h2 { margin-right: auto }
button { padding: .25rem .625rem; border-radius: 999px; border: 1px solid var(--rule);
  background: var(--raised); color: var(--muted); font: 500 .75rem/1.2 var(--mono) }
button:hover:not(:disabled) { color: var(--ink); border-color: var(--muted) }
button:disabled { opacity: .5 }
.failure { white-space: pre-wrap; font: 400 .75rem/1.5 var(--mono); color: var(--bad); margin: 0 }
.bar { height: 2px; background: var(--rule); overflow: hidden }
.bar i { display: block; height: 100%; width: 0; background: var(--good); transition: width .2s }
</style>
<header>
  <div class="head">
    <h1>Status</h1>
    <span id="overall" class="ex-tag">nothing run yet</span>
    <button type="button" id="all">Run everything</button>
  </div>
  <p class="ex-note" id="where">Every number here is produced when you ask for it. Nothing is authored and nothing is cached.</p>
</header>
<div id="sections"></div>
<script src="/status.js"></script>
</html>
`
