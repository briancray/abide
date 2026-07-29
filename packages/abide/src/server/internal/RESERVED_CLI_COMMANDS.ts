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
// `login`/`logout`/`identity`, which are the same argument for WHO rather than WHERE — and `logs`,
// which is WHAT IT IS DOING. Those four are the binary's operational vocabulary about a deployment
// rather than calls into the app, and an author who shadows one loses the ability to ask a question
// about the thing they are shadowing it with. Unlike `serve`, none of them is un-substitutable (an
// operator can curl `/__abide/logs`), so the argument here is consistency of vocabulary, not rescue:
// `identity` sets the precedent, and a reserved list you have to memorise exceptions to is worse than
// one shadowed rpc.
//
// This is the ONE list, because four places have to agree: the dispatcher (`runCompiledApp`), the REPL
// (`interactiveCli`), the generated help (`cliUsage`) and the projection that warns an author their
// rpc is shadowed (`cliCommands`). The last two read the table directly, so a name added here shows up
// in help and in the warning with no second edit. The first two used to reach it through
// `reservedCliCommand` and then branch on the result in TWO hand-written ladders, which bought only
// HALF the guarantee: a name they intercepted that was not here was a compile error, but a name here
// that neither intercepted was nothing at all. `completion` was exactly that — declared `'both'`,
// listed in `help`, warned about as shadowing an author's rpc, and answered `unknown command` at the
// prompt. Both surfaces now dispatch through `reservedCliDispatch`, which is TOTAL over
// `CommandSurfaceReserved`, so the guarantee runs both ways: an entry no surface answers does not
// compile.
//
// `where` is the difference between the two surfaces, not decoration: `exit`/`quit` end a SESSION, so
// they mean nothing on a command line and an rpc named `exit` stays callable as `app exit` — it is
// only unreachable from the prompt. The shadow warning says which of the two it is.
export const RESERVED_CLI_COMMANDS = {
    serve: {
        where: 'both',
        description: 'host the app in the foreground (--port <n>)',
    },
    connect: {
        where: 'both',
        description: 'point at a deployment until `disconnect` (<url>; bare = show where)',
    },
    disconnect: {
        where: 'both',
        description: 'forget that target and go back to hosting the app',
    },
    login: {
        where: 'both',
        description: 'remember a credential for the deployment you point at (--token <t>)',
    },
    logout: {
        where: 'both',
        description: 'drop that credential (locally — the token stays valid until it expires)',
    },
    identity: {
        where: 'both',
        description: 'ask the server who it thinks you are',
    },
    logs: {
        where: 'both',
        description:
            'stream logs from the deployment (--tail <n> --level <l> --debug <pat> --trace <id> --no-follow)',
    },
    help: {
        where: 'both',
        description: 'this help; `help <command>` for one command',
    },
    completion: {
        where: 'both',
        description: 'print the shell completion script (bash|zsh|fish)',
    },
    exit: {
        where: 'prompt',
        description: 'leave the interactive session (interactive only)',
    },
    quit: {
        where: 'prompt',
        description: 'leave the interactive session — alias of `exit` (interactive only)',
    },
} as const satisfies Record<string, { where: 'both' | 'prompt'; description: string }>

// A name the binary keeps for itself. `'both'` names are intercepted on the command line AND at the
// prompt; `'prompt'` names only at the prompt.
export type ReservedCliCommand = keyof typeof RESERVED_CLI_COMMANDS

// The names that mean something on a COMMAND LINE. DERIVED from `where` rather than restated, which is
// what makes that field checked by the type system and not only at runtime: `reservedCliCommand(head,
// 'command')` returns this, and `reservedCliDispatch` is total over it.
export type CommandSurfaceReserved = {
    [Name in ReservedCliCommand]: (typeof RESERVED_CLI_COMMANDS)[Name]['where'] extends 'both'
        ? Name
        : never
}[ReservedCliCommand]

// The rest: names that end a SESSION and so mean nothing as a subcommand. The prompt answers these
// itself — they are loop control, not calls — and its own switch is total over this.
export type PromptOnlyReserved = Exclude<ReservedCliCommand, CommandSurfaceReserved>
