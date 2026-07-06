# ADR-0017: The side-crossing guard stays inside the resolver plugin

**Status:** accepted (2026-07-06)

## Context

`abideResolverPlugin` is ~1060 lines, and architecture reviews keep flagging
its size. The concrete proposal this time: lift the side-crossing guard (the
`importerOf` edge graph, `sideCrossingChain` evidence formatting, and
`recordAndGuard`, ~55 lines at factory scope) into its own module, since it is
the densest behavioral cluster left after the per-surface rewrites
(`prepareRemoteExport` and friends) and the shell-injection helpers were
already factored out.

On inspection the extraction buys nothing:

- **The plugin is the module; the guard is implementation.** The guard's
  interface is "what a client-target build does when a non-server module
  reaches a server-only one" — inseparable from Bun's resolve hooks, the
  rpc/socket proxy exception, and the per-build reset in onStart.
  `resolverSideCrossing.test.ts` already tests exactly that surface: a real
  `Bun.build` over a fixture project asserting the violation, the allowed
  proxied import, and the evidence-chain order. A unit test of an extracted
  guard would test *past* the real interface.
- **One adapter.** Nothing else consumes edge recording or chain formatting;
  the seam would be hypothetical.
- The remaining size is inherent bundler-plugin surface: virtual-module
  loaders that each do one thing, already delegating to named single-source
  helpers.

## Decision

Keep the guard where it is, as documented factory-scope functions. Don't
split `abideResolverPlugin` for size alone.

## Consequences

- New guard behavior (say, a warning tier) is added inline and characterized
  through the build-level test, same as today.
- Re-propose extraction only when a second consumer of the edge graph
  actually appears (e.g. an LSP diagnostic that wants the same chain
  evidence without running a build).
