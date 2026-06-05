---
"@briancray/belte": minor
---

Add an `error.svelte` page convention. Drop `error.svelte` anywhere under `src/browser/pages/` and it renders on the server for an unknown route (404) or a throw during a page render, inside the nearest layout, receiving `{ status, message, stack }` props. The props are never serialized to the client, so the message and stack reach the browser only where the template renders them — a bare `error.svelte` leaks nothing while a dev page can show the stack. Resolution is nearest-only by directory prefix, mirroring layouts — `pages/admin/error.svelte` covers `/admin/*`, `pages/error.svelte` covers the rest. For page renders `error.svelte` takes precedence over the `app.handleError` hook, which remains the fallback when no `error.svelte` covers the path (and for rpc throws). The error document is static — the client skips hydration — and a failed SPA navigation hard-navigates so it lands on the server-rendered error page.
