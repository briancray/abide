* you are making a ssr + spa framwork for bun and svelte.
* ignore changes to README and examples unless i specifically instruct you to

# project goals

* exclusively use bun apis and javascript native apis when they're available
* keep the api surface small, based on standards, and ergonomic
* maintain high visibility into the stack for debugging
* maintain a consistent runtime between all modes (dev and build)
* isomorphism by default — same callable, same name, same behavior on both sides; the bundler swaps the runtime
* no barrels. Every public name has its own module path: `belte/server/GET`, `belte/server/socket`, `belte/server/json`, `belte/browser/cache`, `belte/browser/page`, …. `belte/server` and `belte/browser` are namespaces — there is no umbrella `index.ts`, so importing a single name never drags side-effecting siblings into the bundle.
* value performance when all other conditions are met

# coding guidelines

* src/lib is split three ways: `lib/server/` (server-only — public names like `GET.ts` / `socket.ts` / `json.ts` / `request.ts` sit flat at the top; internal helpers live in `rpc/` / `sockets/` / `runtime/` sub-modules + each sub-module's `types/`), `lib/browser/` (html consumer — `cache.ts` / `subscribe.ts` / `page.svelte.ts` + the bundler-target proxies), and `lib/shared/` (cross-side machinery + cache infra + build-time helpers + `types/` for cross-side types). Future consumer surfaces sit as siblings to `browser/`. No `index.ts` barrels anywhere.
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
