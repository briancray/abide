// What this console can do that is not an endpoint — the table, and the screen is GENERATED from it.
//
// The same discipline `COMMANDS.ts` states for the binary's own subcommands: an action that exists is
// one that is documented, and one that is documented is one you can type. There is no `switch` to
// fall out of step with the help.
//
// These are DELIBERATELY few. The surface is mostly the app's — every rpc and socket it
// declares — and everything here is something an app cannot answer for itself: where this session is
// pointed, and what abide serves about the app rather than what the app serves. `health` and
// `identity` are the two that look like exceptions and are not: both are `/__abide/**` addresses that
// exist in every app, so answering them here is asking the app rather than inventing a reply.
//
// An action WINS a name collision with an endpoint, and that is worth knowing rather than defending
// against: an app with an rpc called `health` is still reachable at its address by every other
// caller, and resolving the app's first would mean `connect` stopped working
// the day somebody declared an endpoint by that name.

import { config } from '#server/config.ts'
import { HEALTH_PATH, IDENTITY_PATH } from '#shared/internal/PATHS.ts'
import { CLI_EXIT_CODES } from '../CLI_EXIT_CODES.ts'
import { endpointLines, said } from './calls.ts'
import { portFrom } from './layers.ts'
import { logs } from './logs.ts'
import { aligned, BOLD, colored, paint } from './paint.ts'
import type { Session } from './session.ts'

export interface Action {
    name: string
    /** How the arguments are spelled, for the usage line. Empty when it takes none. */
    args: string
    blurb: string
    /**
     * True for an action that does not RETURN — one that leaves a socket listening, so the process
     * ends when it is signalled rather than when the line does.
     *
     * On the row rather than in the caller: a name matched by a string there is one a rename leaves
     * exiting with a server bound, silently.
     */
    holds?: boolean
    run: (session: Session, argv: string[]) => Promise<number>
}

export const ACTIONS: Action[] = [
    {
        name: 'connect',
        args: '<url>',
        blurb: 'Point this at an app that is already running. Remembered for the next run.',
        run: async (session, argv) => {
            const url = argv[0]
            if (url === undefined || url.startsWith('-')) {
                console.error('connect: needs a url — `connect http://localhost:3000`')
                return CLI_EXIT_CODES.usage
            }
            let named: string
            try {
                named = new URL(url).href
            } catch {
                console.error(`connect: "${url}" is not a url`)
                return CLI_EXIT_CODES.usage
            }
            await session.connect(named)
            // Asked rather than assumed, because the address was taken on trust: what makes this
            // useful is being told NOW that nothing is there, instead of by the first call.
            const catalogue = await session.catalogue()
            if (catalogue === null) return CLI_EXIT_CODES.failed
            console.log(`connected to ${named} · ${catalogue.length} endpoints`)
            return CLI_EXIT_CODES.ok
        },
    },
    {
        name: 'disconnect',
        args: '',
        blurb: 'Let go: stop a server this started, or forget the app it was pointed at.',
        run: async (session) => {
            const held = session.address
            await session.disconnect()
            console.log(held === null ? 'nothing was connected' : `disconnected from ${held}`)
            return CLI_EXIT_CODES.ok
        },
    },
    {
        name: 'serve',
        args: '[--port <n>]',
        holds: true,
        blurb: 'Bind the app this binary carries, and talk to that. Remembered for the next run.',
        run: async (session, argv) => {
            // `portFrom`, not `flagsOf`: the same scan `abide start` and `abide dev` read a `--port`
            // with, so the three cannot disagree about what a port IS — and it REFUSES an unknown
            // option, where a query-shaped scan would drop `--prot 4000` and bind the default.
            const asked = portFrom(argv)
            if (typeof asked === 'string') {
                console.error(`serve: ${asked}`)
                return CLI_EXIT_CODES.usage
            }
            // `config()`, not a constant: an app that declared its own default gets it, and the floor
            // is 3000. The flag is the more specific statement and wins.
            return await session.serve(asked ?? config().PORT)
        },
    },
    {
        name: 'health',
        args: '',
        blurb: "The app's own account of whether it is working.",
        run: (session) => ask(session, HEALTH_PATH, 'health'),
    },
    {
        name: 'identity',
        args: '',
        blurb: 'Who the app resolved this caller to be.',
        run: (session) => ask(session, IDENTITY_PATH, 'identity'),
    },
    {
        name: 'logs',
        args: '',
        blurb: "Tail the app's log feed until this is interrupted.",
        // The same tail `abide logs` is, pointed at THIS session's target rather than resolving one
        // of its own — saying it is connected to one app and tailing another is the failure that
        // reads as "nothing is being logged".
        run: async (session, argv) => {
            const base = await session.target()
            return base === null ? CLI_EXIT_CODES.failed : await logs(argv, base)
        },
    },
    {
        name: 'help',
        args: '',
        blurb: 'This, and every endpoint the app declares.',
        run: async (session) => {
            console.log(await usage(session))
            return CLI_EXIT_CODES.ok
        },
    },
    {
        name: 'exit',
        args: '',
        blurb: 'Leave the prompt. Ctrl-D does the same.',
        run: async (session) => {
            session.leave()
            return CLI_EXIT_CODES.ok
        },
    },
]

export function actionNamed(name: string): Action | undefined {
    for (const action of ACTIONS) if (action.name === name) return action
    return undefined
}

/** One `/__abide/**` document, printed — through the same reader an endpoint call answers with. */
async function ask(session: Session, path: string, name: string): Promise<number> {
    const answered = await session.ask(path)
    return answered === null ? CLI_EXIT_CODES.failed : await said(name, answered)
}

/**
 * The screen: what this console does, then what the APP does.
 *
 * The two halves are asked of two different places on purpose — the first is this table and the
 * second is `GET /__abide/schema`, which is the app's own answer. So a console pointed at an app is
 * documenting THAT app, and pointing it somewhere else changes the second half of the screen.
 *
 * That second half is why there is no `endpoints` action: listing what the app declares IS the help,
 * and a command that printed the same list under another name would be a second answer to "what can
 * I type" — the one that goes stale. So this ASKS, and a help screen binding a socket to answer
 * honestly is the right trade: it is the question that cannot be answered without the app.
 */
export async function usage(session: Session): Promise<string> {
    const on = colored()
    const rows: [string, string][] = []
    for (const action of ACTIONS) {
        rows.push([action.args === '' ? action.name : `${action.name} ${action.args}`, action.blurb])
    }

    const lines = [paint('this console', BOLD, on), '']
    for (const line of aligned(rows, on)) lines.push(line)

    const catalogue = await session.catalogue()
    if (catalogue !== null && catalogue.length > 0) {
        lines.push('', paint(`this app, at ${session.where}`, BOLD, on), '')
        for (const line of endpointLines(catalogue, on)) lines.push(line)
    }
    return lines.join('\n')
}
