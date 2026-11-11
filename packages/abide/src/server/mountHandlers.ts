// 16.2 — THE MOUNTED HANDLERS: the table the build writes, each row's handler imported at boot and
// keyed by its method and address, with the rungs its route filed over it.

import type { CopyOptions } from '#shared/CopyOptions.ts'
import type { JsonValue } from '#shared/JsonValue.ts'
import type { Gated, HeldToAnnotation } from '#shared/reactive/argsContract.ts'
import type { Defaults } from '#shared/reactive/parameterDefaults.ts'
import type { Method, Rpc } from '#shared/rpc.ts'

import { addressed } from './addressed.ts'
import { answered } from './answerFailure.ts'
import { derivedArgs } from './argsContract.ts'
import { type LaneRung, rungsOver } from './hooks.ts'

/**
 * One row of the handler table the build writes into the server's table (`SERVER_TABLE`): where a
 * handler answers, and its module.
 *
 * The module is relative to the app's root, which both commands that serve already know.
 */
export type Mount = {
    address: string
    method: Method
    source: string
    /** The handler file's name, or the private handler's binding. */
    name: string
    /** What the source's module exports it as: `default` for a handler file. */
    export: string
    /** The route its hooks are filed at, which its rungs are read over (37.1, 16.72). */
    scope: string
    /** 23.26 — each matcher its address names, to the anchored source its row is ranked with. */
    matchers: Record<string, string>
    /** Whether it is a private handler, listed nowhere (16.71). */
    private: boolean
    /** Whether a browser is handed a wrapper for it. 20.4. */
    ui: boolean
    /** Whether the command line lists it — the shell's listing and completion, never whether `call` reaches it. 20.3, 38.62. */
    cli: boolean
    /**
     * Whether MCP lists it where its runtime `clients` does not say.
     *
     * 16.37 — false for a handler typed as returning a `Response`, which only the build can tell.
     */
    mcp: boolean
    /** Its `description`, where the declaration writes one as a literal the build can read. */
    description: string | undefined
    /**
     * The rung each entry of its declaration's `middleware` names, as written; `null` where the
     * options are not written where the build can read them. 38.135.
     */
    middleware: string[] | null
    /**
     * What a `GET`'s value declares that the browser's copy behaves by, or `undefined`.
     *
     * 18.4 — set where its declaration names any of it.
     */
    copy: CopyOptions | undefined
    /**
     * The defaults the handler's parameter writes, for the browser's copy to key by.
     *
     * 11.29 — the server reads its own off the handler.
     */
    defaults: Defaults | undefined
    /** The JSON Schema the handler's args annotation derives, where it takes a record. 19.9. */
    args: JsonValue | undefined
    /** The JSON Schema of what it answers, where its type says one. 19.21. */
    result: JsonValue | undefined
}

/**
 * A row of the table the build wrote, with the import of the module its handler is declared in —
 * the handler file itself, or a private handler's `.abide` server module, the one the route table
 * loads too, so a page and a call reach one handler.
 */
export type MountRow = Mount & { load: () => Promise<Record<string, unknown>> }

/** A handler's row, mounted: the handler imported and its args schema probed. */
export type Mounted = Mount & {
    /**
     * The rungs filed over `scope`, read once at mount (16.14) — what an http call and a socket
     * subscription to it both pass through (37.2, 18.26).
     */
    rungs: LaneRung[]
    handler: Rpc<unknown, unknown> & Gated<unknown> & HeldToAnnotation
}

/**
 * What following a handler reads of its row: where it answers, the rungs its route filed, the
 * handler, and the `tags` its copy carries. 18.3, 18.8, 18.26.
 */
export type FollowedHandler = Pick<
    Mounted,
    'address' | 'rungs' | 'handler' | 'copy'
>

/**
 * The `GET` a browser follows at each address among `handlers` — one it is handed a wrapper for
 * (20.4) — or `undefined`; or one abide mounts itself that `followedOwn` made followable.
 */
export function followedIn(
    handlers: Map<string, Mounted>,
): (address: string) => FollowedHandler | undefined {
    return (address) => {
        const found = handlers.get(handlerKey('GET', address))
        return found?.ui === true ? found : OWN_FOLLOWED.get(address)
    }
}

/**
 * What a follow of a handler is watched by, run in the follower's connection scope as it follows —
 * the request its upgrade carried, and so its `principal.caller` and its sign-in — and handed what
 * sends that one follower a trigger; it returns what stops watching, run as the follow stops.
 *
 * 18.36 — A FOLLOWER IS REACHED BY WHO IT IS, not by the args it named: what the watch reads off the
 * scope is what it files `poke` under, so a change to one browser's state reaches that browser's
 * followers alone, and the browser never names whose state it follows.
 */
export type FollowWatch = (
    poke: (member: 'invalidate' | 'refresh') => void,
) => () => void

const OWN_FOLLOWED = new Map<string, Mounted>()
const WATCHES = new WeakMap<object, FollowWatch>()

/** Makes `own`, a handler abide mounts itself, followable over the mux, each follow watched by `watch`. */
export function followedOwn(
    own: [string, Mounted],
    watch: FollowWatch,
): [string, Mounted] {
    OWN_FOLLOWED.set(own[0], own[1])
    WATCHES.set(own[1].handler, watch)
    return own
}

/** What watches each follow of `rpc`, or `undefined`. */
export function watchOf(rpc: object): FollowWatch | undefined {
    return WATCHES.get(rpc)
}

/**
 * The row of a handler abide mounts itself, keyed by its bare address as `answerRequest`'s `OWN_HANDLERS` looks one up.
 *
 * Built on the core's `declare` with no generated surface (20.1) — the app's tree never names it.
 */
export function mountedOwn(
    address: string,
    name: string,
    handler: object,
): [string, Mounted] {
    addressed(handler, address)
    return [
        address,
        {
            address,
            method: 'GET',
            // The root's rungs run before routing (37.3), and nothing is filed below a route
            // of abide's own.
            rungs: [],
            source: '',
            name,
            export: name,
            scope: '/',
            matchers: {},
            private: false,
            ui: false,
            cli: false,
            mcp: false,
            description: undefined,
            middleware: [],
            copy: undefined,
            defaults: undefined,
            args: undefined,
            result: undefined,
            handler: handler as Mounted['handler'],
        },
    ]
}

/**
 * The table's handlers, imported and keyed by method and address.
 *
 * Imported through each row's own loader, which the route table shares, so a page rendering on the
 * server and a call over the wire reach one module and so one handler. AT BOOT rather than on the
 * first call, because a page's render reaches a handler through the page's own import and has to
 * know its address before anything has called it over the wire.
 */
export async function mountHandlers(
    table: MountRow[],
): Promise<{ handlers: Map<string, Mounted> }> {
    const modules = await Promise.all(table.map((mount) => mount.load()))
    const handlers = new Map<string, Mounted>()
    for (let at = 0; at < table.length; at += 1) {
        const mount = table[at] as Mount
        const exported = (modules[at] as Record<string, unknown>)[mount.export]
        const handler = exported as Mounted['handler']
        // 16.9, 16.10 — the address `rpc.url` and `rpc.raw` build on, under the mount — and what a
        // page's render turns a call it made into the browser's request by (41.20).
        addressed(handler, mount.address)
        // 19.9 — the schema the build derived off its annotation, for a handler whose module did not
        // file it on load: a bundled executable's faces carry no `derivedArgs` call.
        if (mount.args !== undefined) derivedArgs(handler, mount.args)
        handlers.set(handlerKey(mount.method, mount.address), {
            ...mount,
            // 37.1, 16.72 — the route its file's hooks are filed at, which the build read off
            // where the file answers (23.19's mount for a package's), never its place on disk.
            // 37.14 — a handler's lane answers a refusal as Problem Details (15.1).
            rungs: rungsOver(mount.scope, answered),
            handler,
        })
    }
    return { handlers }
}

/** What a handler is keyed by among the mounted: its method and its route. 19.1. */
export function handlerKey(method: string, address: string): string {
    return `${method} ${address}`
}
