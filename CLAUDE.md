* you are making a type-safe isomorphic framwork built on web standards and bun.
* ignore changes to README and examples unless i specifically instruct you to

# project goals

* exclusively use bun apis and javascript native apis when they're available
* keep the api surface small, based on standards, and ergonomic
* maintain high visibility into the stack for debugging
* maintain a consistent runtime between all modes (dev and build)
* isomorphism by default — same callable, same name, same behavior on both sides; the bundler swaps the runtime
* no barrels. Every public name has its own module path: `abide/server/GET`, `abide/server/socket`, `abide/server/json`, `abide/shared/cache`, `abide/shared/HttpError`, `abide/ui/state`, …. `abide/server`, `abide/ui`, and `abide/shared` are namespaces — there is no umbrella `index.ts`, so importing a single name never drags side-effecting siblings into the bundle. The namespace marks the side a name runs on: `abide/server/*` server-side, `abide/ui/*` client-side, `abide/shared/*` isomorphic (same callable, same behaviour on both sides — e.g. `cache`, `HttpError`).
* value performance when all other conditions are met

# coding guidelines

* src/lib is split three ways: `lib/server/` (server-only — public names like `GET.ts` / `socket.ts` / `json.ts` / `request.ts` sit flat at the top; internal helpers live in `rpc/` / `sockets/` / `runtime/` sub-modules + each sub-module's `types/`), `lib/ui/` (client surface — the abide-ui framework itself in `compile/` / `dom/` / `runtime/` plus the client consumer glue flat at the top: the bundler-target proxies (`remoteProxy` / `socketProxy`), `tail`, and the cache's client-only streaming/hydration helpers), and `lib/shared/` (isomorphic surface — the cross-side public callables like `cache.ts` / `HttpError.ts` alongside the cross-side machinery, cache infra, build-time helpers, and `types/` for cross-side types). A feature that spans sides (e.g. cache) keeps its isomorphic core + infra in `shared/`, its client-only extensions in `ui/`, and its server-only extensions in `server/runtime/`. No `index.ts` barrels anywhere.
* use bun apis not node apis when possible
* only one export per file named after the export
* every name in package.json's `exports` map carries a `// @readme <slug>` comment directly above its export — the slug is its README section (or `plumbing` if it carries no user-facing prose). Run `bun run packages/abide/scripts/readmeSurfaces.ts` to list slugs and catch any untagged export; pick a new slug only when no existing one fits.
* write pure functions and use functional style programming
* use the minimal amount of code to achieve a goal
* use descriptive variable names instead of abbrevations
* write short descriptive comments above each function and above code blocks that need explanation
* use /* and */ for multiline comments and // for single line comments
* comment as if every word costs money but losing a technical detail or its nuance costs more. no filler words
* always use full known types where possible instead of creating adhoc one-use types
* if a function is shared, add it to the proper  folder and check library folders for existing functionality before writing one
* run bun format on a file after all changes complete
* use tailwindcss classes for styling, and prefer tailwind classes over style properties when possible.
* always use openining and closing brackets for if statements, no single line ifsn on
* if you're transforming data, prefer functional instance and static methods like map, filter, reduce etc over for loops when applicable
* use undefined instead of null for nullish values unless a type needs null
* constants should be UPPERCASE_SNAKE_CASE always, including their files
