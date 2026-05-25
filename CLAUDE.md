you are making a ssr + spa framwork for bun and svelte.

# project goals

* exclusively use bun apis and javascript native apis when they're available
* keep the api surface very small and simple
* maintain high visibility into the stack for debugging
* maintain a consistent runtime between all modes (dev and build)
* isomorphism by default — same callable, same name, same behavior on both sides; the bundler swaps the runtime (defineVerb/remoteProxy, defineSocket/socketProxy). user code never branches on `typeof window`.
* framework owns the network — no parallel "raw" escape hatches that fragment the model. one way to call rpc, one way to consume streams, one ws connection. if a primitive feels too low-level for users, hide it.
* group exports by lifecycle phase, not by implementation — declare (`belte/rpc`) → reply (`belte/response`) → consume (`belte/cache`). new helpers go in the phase they belong to; if a new phase emerges, that's a new module.
* value performance when all other conditions are met

# coding guidelines

* write library files into src/lib with separate folders for types, server (utils), client (utils), shared (utils).
* do not use node apis when a bun api can be used
* use one export per file named after the export
* no need to create files for file-local module bindings
* use functional style programming with pure functions
* prefer approaches using modern javascript apis when comparing two of the same approaches
* always use full known types where possible instead of creating adhoc one-use types
* always use openining and closing brackets for if statements, no single line ifs
* if you're transforming data, prefer instance and static methods like reduce and map over for loops when applicable
* use undefined instead of null for nullish values unless a type needs null
* write svelte 5 components
* run bun format on a file after changes
* use tailwindcss classes for styling, and prefer tailwind classes over style properties when possible.
* use Svelte 5's $derived for derived reactives unless $derived.by() is explicitly needed
* reactive consumers (cache, subscribe, future ones) use `createSubscriber` from `svelte/reactivity` so the surrounding $derived/$effect drives the underlying resource lifecycle — open on first read, close on last reader. don't invent parallel reactivity machinery.
* do not start long living bun servers with `bun run dev`. When i type that it's a mistake
* use descriptive variable names instead of abbrevations
* add descriptions above all functions and logic that is otherwise exceptional or unexpected
* use /* and */ for multiline comments in javascript. dont use per-line markers so that linewidth formatting can change.
