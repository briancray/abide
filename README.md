# abide

An isomorphic, type-safe framework for async interfaces — for humans and for machines — built on Bun and
web standards. Three primitives, one template tag, two substrates.

```abide
<script module>
import { memo, state } from 'abide'

export const query = state('ab')

// Declaring an argument says the args are the dependency set — and the cache key.
const hits = memo(async ({ text }: { text: string }) => search(text))
</script>

<input bind:value={query} />

{#if hits({ text: query }).pending()}
    <p>searching…</p>
{:else}
    <ul>{#for hit of hits({ text: query })()}<li>{hit}</li>{/for}</ul>
{/if}
```

Nothing there awaits. A read with nothing to serve yet SIGNALS, and the walk runs the body again when
the load lands — on the server that means the shell streams out with the placeholder in it, and on the
client it means the region fills in. Same file, both lanes.

## What an app looks like

Four directories, and abide reads them — nothing declares a route, an endpoint or an entry point.

```
src/server/   app.ts, rpc/**, sockets/**, and your own server code
src/ui/       app.html, app.css, pages/**, public/**, and your own components
src/shared/   what both sides run
src/tests/    what neither serves
```

The same four are the seams you import across, declared once in your `package.json` and resolved by
Bun, `tsc` and the bundler alike — no tsconfig `paths`, and no `../../` anywhere:

```json
"imports": {
    "#server/*": ["./src/server/*", "./.abide/types/src/server/*"],
    "#ui/*":     ["./src/ui/*",     "./.abide/types/src/ui/*"],
    "#shared/*": ["./src/shared/*", "./.abide/types/src/shared/*"],
    "#tests/*":  ["./src/tests/*",  "./.abide/types/src/tests/*"]
}
```

The second entry in each pair is where the `.abide` type mirror is generated; the real file is found
first, so it costs nothing at run time. The rest of the config is one line:

```json
{ "extends": "abide/tsconfig.json", "include": ["**/*.ts", ".abide/types/**/*.ts"] }
```

`packages/dogfood` is written this way, which is what keeps it honest.

## The packages

| | |
| --- | --- |
| `packages/abide` | the framework: the reactive core, both renderers, the `.abide` compiler, the CLI |
| `packages/harness` | the harness everything is tested and measured with. `harness/measure` has **no abide in its graph**, which is what lets a hand-written arm be timed by the same clock as an abide one |
| `packages/dogfood` | the dogfood: one app, three views of every capability, plus the use cases at scale on `/demos` |

## Running it

```sh
bun install
bun run dev          # the dogfood app
bun run typecheck    # from the repo root
bun test             # from the repo root — the preload lives in its bunfig
```

An app is also a THING YOU TALK TO. `abide compile` writes one standalone executable — the runtime,
the framework, the app, its pages, its bundle and its public files — whose front door is the app's own
console:

```sh
abide compile                  # ./<app>, one file, nothing else to install
./app serve --port 3000        # be the server
./app getUser --id=1           # or call one: the flags are the endpoint's declared arguments
./app connect https://prod/    # point it somewhere else — remembered for next time
./app                          # the prompt, where you left it
```

What can be typed is the app's own endpoints — read from `GET /__abide/schema`, so it drives whatever
it is pointed at rather than only what it was built with — plus `connect`, `disconnect`, `serve`,
`health`, `identity` and `logs`. `help` lists both halves. The same line means the same thing at the
prompt and in a script, and a call is a real request either way. Without compiling, `abide console` is
the same console against the app in the working directory.

`bun run dev` serves three views of the same nineteen capabilities:

- **`/docs/<capability>`** — a LADDER of examples. Each rung is the one above it plus exactly one new
  thing, and says which. Every rung is a real file this app compiles, shown as its own text and mounted
  live where there is something to see.
- **`/tests/<capability>`** — every claim as a row with its status, run in your browser. The same bodies
  `bun test` runs; open a row for its assertions and the code that made them.
- **`/bench/<capability>`** — those cases against hand-written equivalents: time as a RATIO, work as DOM
  calls, reactivity as wake-ups, emitted code as its budget.

## Why it is arranged this way

A demo that is only a demo rots: it renders something plausible and nobody notices when the plausible
thing stops being true. A test that is only a test documents nothing. So there is one `Case`, and the
three views above are three faces of it — which is why the reference cannot drift from what runs.

The measurement rules are stricter than the correctness ones, because the failures are silent. A
performance claim is a ratio against hand-written code in the same substrate; a "does less work" claim is
COUNTED rather than timed, since the wrong implementation produces exactly the right output at full cost;
and in a reactive system the contract is wake-ups, which no value can show. `docs/SPEC.md` is the spec,
`CLAUDE.md` is the working discipline, and both are meant to be read before changing anything.
