---
"@abide/abide": minor
---

SSR auto-streaming for pending bare async reads (ADR-0024). A triggered point read still pending at render-return now streams its value into the HTML (shell first, then a resolve chunk) instead of shipping buffered — the server triggers the read and drains it as it settles, bounded by a per-render deadline that fail-closes a never-settling read to a client refetch (never an open-ended hang). A page with no async reads still ships buffered; the Tier-2 blocking barrier and Tier-3 `{#await}` streaming are unchanged.
