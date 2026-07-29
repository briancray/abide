// reservedCliCommand(name, where) — classify a command-line/prompt token against the ONE reserved list.
//
// Both the dispatcher and the REPL branch on the result rather than on string literals, so the names
// they intercept are the names `RESERVED_CLI_COMMANDS` declares: drop an entry and every branch that
// handled it stops type-checking, instead of quietly becoming dead code while an author's rpc of that
// name stays shadowed by nothing.
//
// `where` is the asking surface: the command line sees only the `'both'` names (an `exit` SUBCOMMAND is
// meaningless — there is no session to leave — so it falls through to the rpc table), the prompt sees
// all of them.
//
// That split is in the RETURN TYPE, not just in the runtime check: asking as `'command'` narrows the
// answer to `CommandSurfaceReserved`, so the command line cannot be handed a name it has no way to
// mean, and the shared dispatcher can be total over that narrower set without a dead `exit` branch.

import {
    type CommandSurfaceReserved,
    RESERVED_CLI_COMMANDS,
    type ReservedCliCommand,
} from './RESERVED_CLI_COMMANDS.ts'

export function reservedCliCommand(
    name: string | undefined,
    where: 'command',
): CommandSurfaceReserved | undefined
export function reservedCliCommand(
    name: string | undefined,
    where: 'prompt',
): ReservedCliCommand | undefined
export function reservedCliCommand(
    name: string | undefined,
    where: 'command' | 'prompt',
): ReservedCliCommand | undefined {
    if (name === undefined) return undefined
    if (!Object.hasOwn(RESERVED_CLI_COMMANDS, name)) return undefined
    const reserved = name as ReservedCliCommand
    if (where === 'command' && RESERVED_CLI_COMMANDS[reserved].where === 'prompt') return undefined
    return reserved
}
