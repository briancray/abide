// The subcommand names a compiled binary keeps for itself. They WIN over an app rpc of the same name.
//
// The first cut had it the other way — the command namespace belongs to the app, so an rpc named
// `serve` should be callable as `serve`. Removing the `--serve` flag settled it: with no escape
// spelling left, an app that happened to export a `serve` rpc would produce a binary nobody could
// host. Being unable to deploy beats being unable to call one rpc from the command line, and unlike
// the rpc (still reachable over HTTP, MCP and the browser) hosting has no second door.
//
// `connect`/`disconnect` are reserved for the same reason once removed: they are how you change what
// the binary points AT, and a binary you cannot re-target is as stuck as one you cannot host. So are
// `login`/`logout`/`identity`, which are the same argument for WHO rather than WHERE.
//
// Named once because four places have to agree: the dispatcher, the REPL, the generated help, and the
// projection that warns an author their rpc is shadowed.
export const RESERVED_CLI_COMMANDS = [
    'serve',
    'help',
    'connect',
    'disconnect',
    'login',
    'logout',
    'identity',
] as const
