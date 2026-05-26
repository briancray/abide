you are making a ssr + spa framwork for bun and svelte.

# project goals

* exclusively use bun apis and javascript native apis when they're available
* keep the api surface small, based on standards, and ergonomic
* maintain high visibility into the stack for debugging
* maintain a consistent runtime between all modes (dev and build)
* isomorphism by default — same callable, same name, same behavior on both sides; the bundler swaps the runtime
* one flat umbrella per side: `belte/server` collects everything server-only (rpc verbs, the `socket()` helper, `respond/*`, `request`, `server`); each consumer surface gets its own flat umbrella named after the consumer (`belte/browser` for html clients, future siblings like `belte/cli` / `belte/mcp`).
* value performance when all other conditions are met

# coding guidelines

* src/lib is split three ways: `lib/server/` (server-only code, with `rpc/`, `sockets/`, `respond/`, `runtime/` sub-modules + each sub-module's `types/`), `lib/browser/` (the html-browser consumer surface — page state, navigate, cache, subscribe, the client-side proxies wired by the bundler), and `lib/shared/` (cross-side machinery + cache infra + build-time helpers, plus a `types/` for cross-side types). Future consumer surfaces sit as siblings to `browser/` (e.g. `lib/cli/`, `lib/mcp/`).
* use bun apis not node apis when possible
* only one export per file named after the export
* write pure functions and use functional style programming
* use the minimal amount of code to achieve a goal
* use descriptive variable names instead of abbrevations
* write short descriptive comments above each function and above code blocks that need explanation
* use /* and */ for multiline comments and // for single line comments
* write svelte 5 components
* always use full known types where possible instead of creating adhoc one-use types
* if a function is shared, add it to the proper  folder and check library folders for existing functionality before writing one
* run bun format on a file after all changes complete
* use tailwindcss classes for styling, and prefer tailwind classes over style properties when possible.
* always use openining and closing brackets for if statements, no single line ifsn on
* if you're transforming data, prefer functional instance and static methods like map, filter, reduce etc over for loops when applicable
* do not start long living bun servers with `bun run dev`. When i type that it's a mistake
* use undefined instead of null for nullish values unless a type needs null
* reactive consumers (cache, subscribe, future ones) use `createSubscriber` from `svelte/reactivity` so the surrounding $derived/$effect drives the underlying resource lifecycle — open on first read, close on last reader. don't invent parallel reactivity machinery.
* do not start long living bun servers with `bun run dev`. When i type that it's a mistake
