// The package's front door: what an author TYPES, and nothing else.
//
//   state   — own      a value
//   memo    — derive or load one (args declared = cache key; no args = inferred from the body)
//   channel — subscribe to them
//
// Curated rather than collected. This file is not the barrel for a directory — every line is a
// decision that a name belongs on the surface an app reads, and there are two tests it has to pass.
// A VALUE is here because a user-facing app types it; the standard is `packages/dogfood`'s own pages
// and server, not its demos, which test the framework rather than use it. A TYPE is here because it
// is the input or the output of one of those values — so `Route` is here and `RouteEntry` is not,
// since `route()` is the call an app makes and the table is written by `abide build`.
//
// Four other entry points hold what that leaves, so nothing arrives here by being in the same folder
// as something that belongs:
//
//   abide/runtime           — what only the COMPILER writes, plus the predicates that read what it
//                             wrote
//   abide/runtime/transport — what a server module elides to: `remote`, `remoteSocket` and the shapes
//                             describing one. Its own specifier because it is otherwise the chunk
//                             every page loads — see `runtime.ts`'s own closing note
//   abide/ui                — the DOM substrate: `mount`, `hydrate`
//   abide/server            — the SSR substrate, the request scope, and the declaring half of both
//                             transports
//
// What is on NONE of them is still reachable at `$shared/*` — `scope`, `untrack` and `isolate` came
// off this file because no page or handler in the dogfood app types one. A suite that tests the graph
// imports them from the module directly, which is the seam it is actually testing.
//
// The two RENDERERS are separate because only one of them ships to a browser. Nothing here imports
// either, so a page pays for the renderer it uses.

export { type Channel, type ChannelOptions, channel, type KeyedChannel } from './src/shared/channel.ts'
// The app's own account of whether it is working, asked the same way on both sides. `useHealthSource`
// is deliberately absent: it is how `abide/server` installs the LOCAL answer — the same shape as the
// app-name source under `log` — and a caller installing one would be answering for an app it is not.
export { type Health, health } from './src/shared/health.ts'
// `html` and `raw` are the two names on both sides of the authored/emitted line: the compiler writes
// the template tag, and a hand-written `.ts` component writes the same one. `raw` is here rather than
// on `abide/runtime` because it is the ESCAPE HATCH and a hatch has to be greppable — one name, said
// the same way in both kinds of file, so one search finds every string this app does not escape. It
// was spelled `{html(...)}` and that made `html` mean escape as a tag and insert-raw as a call, which
// is the one place a reader had to know the syntax to know the trust. `keyed` is still NOT here: a key
// is spelled `by` on a `{#for}`, which is a SPELLING the emitter translates rather than a name.
// `Props` is here for the same reason `props` is: it is the type the emitted parameter is written
// in, so a `.abide` file's own compiled text names it, and an author reading that text can look it up
// where the call it belongs to lives.
export { html, type Props, props, raw, type TemplateResult } from './src/shared/html.ts'
// Who the server decided this caller is, asked the same way on both sides. `useIdentitySource` is
// absent for the reason `useHealthSource` is, and the two WRITERS on `identity` throw in a browser
// rather than being missing from it: a client that could set its own principal is a client that
// guesses one, and one call shape on both sides is what makes that a message rather than a mystery.
export { type Identify, type Identity, identity } from './src/shared/identity.ts'
// The one predicate an app needs about a read that had nothing to serve YET.
//
// Here because a JavaScript `catch` is TOTAL. A read with no value yet signals by throwing, so any
// try/catch an author writes between a slot and a read catches that signal along with the failures it
// was written for — and swallowing it turns "the graph will run this again" into an error message that
// never clears. Nothing else about the signal is surface: `Pending` is not nameable here and
// `settledOf` is not exported, because the only correct thing to do with one is pass it on.
export { isPending } from './src/shared/internal/graph.ts'
// A DECLARED failure, as it is caught — the type `x.isError(e, name)` narrows to. Here because that
// probe is on every source, so it is the output type of a `memo` that fronts an endpoint.
export type { Failed } from './src/shared/internal/wire.ts'
// The console, on both sides. The DEFAULT channel is the app's own output and always writes; a NAMED
// channel is off unless `DEBUG` names it — except `warning` and `error`, which the gate never
// swallows, because the gate is there to control volume rather than to hide breakage. `abideLog` and
// `useAppNameSource` are deliberately absent: the first is the framework's own channel and the second
// is how `abide/server` installs the package.json fallback under `ABIDE_APP_NAME`. `Level` is on
// `abide/server`, beside the `LogRecord` it is a field of — no call here takes or returns one.
export { type Logger, log } from './src/shared/log.ts'
export {
    // Tags name DATA, not the thing holding it, so these are module-level verbs: they reach every
    // slot carrying the tag without the caller knowing which memo that is.
    invalidate,
    type KeyedMemo,
    type MemoHandle,
    type MemoOptions,
    memo,
    refresh,
    type TagSelector,
} from './src/shared/memo.ts'
// The second REACTIVE ambient, and reactive for the same reason `route()` is: connectivity changes
// without a new caller arriving, so a probe answering only on the next ask would leave an offline
// banner up after the network came back.
export { online } from './src/shared/online.ts'
// `Cell` is the shape `State` and `Memo` both extend — the read, the write and the probes every
// source carries — so it is the output type behind both of the values below.
export { type Cell, type Memo, type State, state, watch } from './src/shared/reactive.ts'
// Routing, as an author asks it: where am I, take me there, build me a link. `routes`, `outlet` and
// `ready` INSTALL and RENDER the table and are on `abide/runtime`, because `abide build` writes the
// client entry that calls all three — and `RouteEntry` went with them, since the table is the thing
// an app no longer writes.
export {
    type NavigateOptions,
    navigate,
    type Params,
    type Route,
    type RouteKind,
    route,
    url,
} from './src/shared/router.ts'
// Which app a call is addressed to, which `health()` takes. The rest of the transport types are on
// `abide/runtime/transport` with the `remote` / `remoteSocket` they describe — its own specifier, so
// the call-and-decode path is the chunk of whoever imports it rather than of every page.
export type { WireOptions } from './src/shared/transport.ts'
