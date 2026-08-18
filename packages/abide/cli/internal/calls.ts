// An endpoint called from a command line: `app getUser --id=1`.
//
// The whole of this file is one claim — a flag is a QUERY PARAMETER, so nothing here decides what an
// argument means. `--id=1` becomes `?id=1`, and the endpoint's own declared shape is what turns that
// text into the `1` a handler is called with: `decodeQuery` is the same function the wire runs on a
// read's query string, taking the same JSON Schema off the same catalogue. So this and a browser send
// the same call, and a value that arrives as the wrong type is a shape problem rather than a second
// parser to keep in step.
//
// That also settles the two questions a CLI usually has to invent answers to. A `--tag=a --tag=b`
// repeated flag is a list because a repeated query parameter already is one, and a `--name=42` on a
// declared `name: string` stays the string because the declaration says so. Neither rule is written
// here.
//
// A MUTATION is the same arguments by a different door, and it is the one place this side has to
// decide anything: its method has no query, so the args cross as JSON — where `1` and `"1"` are two
// different values — and only the declared shape says which was meant. So `decodeQuery` runs HERE
// too, against the same schema off the same catalogue, and that is why the catalogue is fetched
// rather than guessed at.

import { stdoutIsTTY } from '#shared/internal/env.ts'
import { RPC_PREFIX, SOCKET_PREFIX, TAIL_PARAM, WAIT_PARAM } from '#shared/internal/PATHS.ts'
import type { EndpointShape } from '#shared/internal/shapes.ts'
import {
    chunksOf,
    decodeQuery,
    encodeArgs,
    errorMessage,
    isChunked,
    JSON_TYPE,
    payloadOf,
} from '#shared/internal/wire.ts'
import { CLI_EXIT_CODES, type CliExitCode, exitForStatus } from '../CLI_EXIT_CODES.ts'
import { colored, DIM, paint, RED } from './paint.ts'
import type { Session } from './session.ts'

/** What a flag looks like, and what its name is. `--id=1`, `--id 1`, `--live`. */
const FLAG = /^--([^=]+)(?:=([\s\S]*))?$/

/**
 * The flags after an endpoint's name, as the query they stand for — or the sentence that refuses.
 *
 * Three spellings and no more: `--name=value`, `--name value`, and a bare `--name` for `true`. The
 * bare form is what a boolean argument reads as on every command line there is, and it is safe here
 * because the shape decides the type: a declared `string` handed `true` is refused by the endpoint
 * rather than silently becoming one.
 *
 * A POSITIONAL is refused rather than guessed at. An abide endpoint takes ONE args object, so a bare
 * word has no name to travel under and any rule for inventing one — first declared property, order
 * of the schema — would be a convention this file made up and the browser lane knows nothing about.
 */
function flagsOf(argv: string[]): URLSearchParams | string {
    const params = new URLSearchParams()
    for (let i = 0; i < argv.length; i++) {
        const argument = argv[i] as string
        const found = FLAG.exec(argument)
        if (found === null) return `arguments are named — try \`--${argument}=…\``
        const name = found[1] as string
        const written = found[2]
        if (written !== undefined) {
            params.append(name, written)
            continue
        }
        // `--id 1`, unless what follows is another flag — in which case this one is the bare form.
        const next = argv[i + 1]
        if (next === undefined || next.startsWith('--')) {
            params.append(name, 'true')
            continue
        }
        params.append(name, next)
        i++
    }
    return params
}

/**
 * One endpoint call, printed. The number is what the shell learns.
 *
 * The three doors are the three an endpoint HAS, and which one is taken is read off the declaration
 * rather than off a flag: a read carries its args in the query, a mutation in a body, and a socket is
 * a tail. There is nothing for a caller to choose, which is the point — the address and the method
 * are facts about the endpoint, and letting a caller override them would mean asking a question the
 * app has no answer for.
 */
export async function call(session: Session, shape: EndpointShape, argv: string[]): Promise<CliExitCode> {
    const params = flagsOf(argv)
    if (typeof params === 'string') {
        console.error(`${shape.id}: ${params}`)
        return CLI_EXIT_CODES.usage
    }

    if (shape.kind === 'socket') return await tail(session, shape, params)

    const method = shape.method ?? 'POST'
    // A read's flags ARE its query — handed over as they were typed, because the far side decodes
    // them against the declaration and that is the authoritative answer. Nothing is coerced here for
    // this door, and a round trip through `decodeQuery`/`argsQuery` to arrive at the same string
    // would be a second decoder to keep in step for no gain.
    //
    // The BODY door is where this side has to decide, because JSON has types and a query does not:
    // `--id=1` crosses as `{"id":1}` or `{"id":"1"}` and only the declared shape says which. So the
    // same `decodeQuery` runs HERE, against the same schema off the same catalogue — the one place a
    // call from here and a call from a browser are not the same two lines.
    const answered =
        method === 'GET'
            ? await session.ask(`${RPC_PREFIX}${shape.id}${params.size === 0 ? '' : `?${params}`}`)
            : await session.ask(`${RPC_PREFIX}${shape.id}`, {
                  method,
                  headers: { 'content-type': JSON_TYPE },
                  body: encodeArgs(decodeQuery(params, shape.input), false).text,
              })
    if (answered === null) return CLI_EXIT_CODES.failed
    return await said(shape.id, answered)
}

/**
 * A socket, over its HTTP arm — the same address a browser upgrades at, asked as a request that ENDS.
 *
 * The two bounds are the caller's and are said out loud, because a socket is a stream that never
 * ends: a command that opened one and waited would be a command with no exit. `--tail` is how many
 * messages are enough and `--wait` is how long to wait for the next one, which are different
 * questions — a count alone blocks forever on a quiet room. They are taken OFF the flags before the
 * rest become the room, since they are this command's and not the app's.
 */
async function tail(session: Session, shape: EndpointShape, params: URLSearchParams): Promise<CliExitCode> {
    const room = shape.room?.properties
    bound(params, 'tail', TAIL_PARAM, room)
    bound(params, 'wait', WAIT_PARAM, room)
    const query = params.size === 0 ? '' : `?${params}`
    const answered = await session.ask(`${SOCKET_PREFIX}${shape.id}${query}`)
    if (answered === null) return CLI_EXIT_CODES.failed
    return await said(shape.id, answered)
}

/**
 * One of this console's two bounds, lifted off the flags and spelled as the reserved name.
 *
 * Only where the ROOM has no member by that name. `PATHS.ts` spells the bounds `__abide_tail` and
 * `__abide_wait` in full precisely because everything else on the query string is the room — and a
 * console that took `--tail` off a room declaring `tail` would put that back, dropping a member from
 * the address and tailing a different room. The declaration is in hand here, so it decides.
 */
function bound(params: URLSearchParams, short: string, reserved: string, room?: object): void {
    if (room !== undefined && short in room) return
    const asked = params.get(short)
    if (asked === null) return
    params.delete(short)
    params.set(reserved, asked)
}

/** What came back, printed — one value, or a line per chunk of a stream. */
export async function said(id: string, answered: Response): Promise<CliExitCode> {
    if (!answered.ok) {
        const payload = await payloadOf(answered).catch(() => null)
        console.error(
            paint(`${id}: ${errorMessage(payload) || `answered ${answered.status}`}`, RED, colored()),
        )
        return exitForStatus(answered.status)
    }

    if (isChunked(answered)) {
        try {
            for await (const chunk of chunksOf(id, answered)) printed(chunk)
        } catch (failure) {
            // The wire's own error FRAME, which arrives mid-body: the status line said 200 long
            // before the handler threw, so this is the only place the failure can be reported.
            console.error(paint(`${id}: ${(failure as Error).message}`, RED, colored()))
            return CLI_EXIT_CODES.failed
        }
        return CLI_EXIT_CODES.ok
    }

    const payload = await payloadOf(answered)
    if (payload !== null) printed(payload)
    return CLI_EXIT_CODES.ok
}

/**
 * A value on stdout, in the shape THIS process's stdout answers to.
 *
 * The same rule `abide logs` follows about a log line, and for the same reason: a terminal is being
 * read by a person and a pipe is being read by a program. So a tty gets `Bun.inspect` with colour and
 * everything else gets ONE LINE of JSON — which is what makes `app getUser --id=1 | jq` work, and
 * what makes a streamed answer a jsonl file.
 */
function printed(value: unknown): void {
    if (stdoutIsTTY()) {
        process.stdout.write(`${Bun.inspect(value, { colors: colored() })}\n`)
        return
    }
    process.stdout.write(`${JSON.stringify(value) ?? 'null'}\n`)
}

/**
 * One endpoint as the help screen names it: the address, and how its arguments are spelled.
 *
 * A socket is spelled by its ROOM rather than by its message, and the two are genuinely different
 * questions — `input` on a socket is what a client PUBLISHES, and this only tails. Spelling the
 * message here read as a list of flags that select nothing, which is the shape of help that sends
 * somebody to the source to find out what it actually takes.
 */
function spelling(shape: EndpointShape): string {
    const declared = shape.kind === 'socket' ? shape.room : shape.input
    let spelled = shape.id
    const properties = declared?.properties
    if (properties !== undefined) {
        const required = new Set(declared?.required)
        for (const name in properties) {
            spelled += required.has(name) ? ` --${name}=…` : ` [--${name}=…]`
        }
    }
    if (shape.kind !== 'socket') return spelled
    // The two bounds are this console's rather than the app's, and a tail without them is a command
    // that does not end — so they are named where somebody reading the line will look for them. Off
    // the line when the ROOM declares one, because there the name is the app's and `bound` leaves it.
    const room = shape.room?.properties
    if (room !== undefined && 'tail' in room) return spelled
    return `${spelled} [--tail=<n>]${room !== undefined && 'wait' in room ? '' : ' [--wait=<ms>]'}`
}

/** The catalogue as the lines that say what can be typed. */
export function endpointLines(shapes: EndpointShape[], colors: boolean): string[] {
    const lines: string[] = []
    for (const shape of shapes) {
        const kind = shape.kind === 'socket' ? 'tail' : (shape.method ?? 'POST')
        const said = shape.description ?? ''
        lines.push(
            `  ${paint(kind.padEnd(6), DIM, colors)} ${spelling(shape)}${said === '' ? '' : `  ${paint(said, DIM, colors)}`}`,
        )
    }
    return lines
}
