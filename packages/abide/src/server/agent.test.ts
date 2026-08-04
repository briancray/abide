import { afterEach, describe, expect, test } from 'bun:test'
import { mockEngine } from '../test/mockEngine.ts'
import { agent } from './agent.ts'
import { error } from './error.ts'
import { GET } from './GET.ts'
import type { AgentFrame, AgentTool, NeutralMessage } from './internal/agentTypes.ts'
import { defaultAgentSurface, provideDefaultAgentSurface } from './internal/defaultAgentSurface.ts'
import { type App, type AppConfig, createApp } from './internal/router.ts'
import { rpcTools } from './internal/rpcTools.ts'

async function collect(stream: AsyncIterable<AgentFrame>): Promise<AgentFrame[]> {
    const frames: AgentFrame[] = []
    for await (const frame of stream) frames.push(frame)
    return frames
}

function user(text: string): NeutralMessage {
    return { role: 'user', content: text }
}

// `rpcTools` dispatches over the app's own HTTP face, so every test that calls a tool's `run` needs a
// SERVING app rather than a bare config — which is the point of the change: there is no in-process door
// left that skips the router. `createApp` also provides the default agent surface itself, so these boot
// the real wiring instead of hand-registering a look-alike.
let booted: App | undefined

async function boot(config: AppConfig): Promise<App> {
    booted = createApp(config)
    return booted
}

afterEach(async () => {
    await booted?.stop()
    booted = undefined
})

// An origin for the projection-only tests (names, docs, schemas) — they never call `run`, so nothing
// is ever fetched from it.
const UNUSED_ORIGIN = 'http://localhost:1'

describe('agent loop', () => {
    test('single turn with no tools yields text frames then done', async () => {
        const engine = mockEngine([
            [
                { type: 'text-delta', text: 'hello ' },
                { type: 'text-delta', text: 'world' },
            ],
        ])

        const frames = await collect(agent(engine, [user('hi')]))

        expect(frames).toEqual([
            { type: 'text-delta', text: 'hello ' },
            { type: 'text-delta', text: 'world' },
            { type: 'done' },
        ])
    })

    test('tool-call runs the tool, appends result to transcript, then continues', async () => {
        let ran: { a: number; b: number } | undefined
        const add: AgentTool = {
            name: 'add',
            run: (args: unknown): number => {
                const typed = args as { a: number; b: number }
                ran = typed
                return typed.a + typed.b
            },
        }

        const engine = mockEngine([
            [{ type: 'tool-call', id: 'c1', name: 'add', args: { a: 1, b: 2 } }],
            [{ type: 'text-delta', text: 'the answer is 3' }],
        ])

        const frames = await collect(agent(engine, [user('add 1 and 2')], { tools: [add] }))

        expect(frames).toEqual([
            { type: 'tool-call', id: 'c1', name: 'add', args: { a: 1, b: 2 } },
            { type: 'tool-result', id: 'c1', result: 3 },
            { type: 'text-delta', text: 'the answer is 3' },
            { type: 'done' },
        ])

        // The tool actually ran with the model's args.
        expect(ran).toEqual({ a: 1, b: 2 })

        // The transcript handed to turn 2 grew: original user msg + assistant tool-use + tool result.
        const secondTurn = engine.turns[1]
        if (secondTurn === undefined) throw new Error('expected a second engine turn')
        expect(secondTurn).toHaveLength(3)
        expect(secondTurn[1]).toEqual({
            role: 'assistant',
            content: [{ type: 'tool-use', id: 'c1', name: 'add', args: { a: 1, b: 2 } }],
        })
        expect(secondTurn[2]).toEqual({
            role: 'tool',
            content: [{ type: 'tool-result', id: 'c1', result: 3 }],
        })
    })

    test('a throwing tool surfaces an error tool-result and the loop continues', async () => {
        const boom: AgentTool = {
            name: 'boom',
            run: (): never => {
                throw new Error('kaboom')
            },
        }

        const engine = mockEngine([
            [{ type: 'tool-call', id: 'c1', name: 'boom', args: {} }],
            [{ type: 'text-delta', text: 'recovered' }],
        ])

        const frames = await collect(agent(engine, [user('go')], { tools: [boom] }))

        const toolResult = frames.find((f) => f.type === 'tool-result')
        expect(toolResult).toBeDefined()
        expect((toolResult as { error?: unknown }).error).toBeInstanceOf(Error)
        expect(((toolResult as { error?: Error }).error as Error).message).toBe('kaboom')

        // Loop continued to the next turn and finished.
        expect(frames.some((f) => f.type === 'text-delta')).toBe(true)
        expect(frames[frames.length - 1]).toEqual({ type: 'done' })

        // The error was also threaded into the transcript for the follow-up turn.
        const followUp = engine.turns[1]
        if (followUp === undefined) throw new Error('expected a follow-up engine turn')
        const toolMessage = followUp[followUp.length - 1]
        if (toolMessage === undefined)
            throw new Error('expected a tool message in the follow-up turn')
        expect(toolMessage.role).toBe('tool')
    })

    test('abort via signal stops the loop', async () => {
        const controller = new AbortController()

        const stop: AgentTool = {
            name: 'stop',
            run: (): string => {
                controller.abort()
                return 'stopping'
            },
        }

        // Every turn asks for the tool again — without the abort the loop would never terminate.
        const engine = mockEngine([
            [{ type: 'tool-call', id: 'c1', name: 'stop', args: {} }],
            [{ type: 'tool-call', id: 'c2', name: 'stop', args: {} }],
            [{ type: 'tool-call', id: 'c3', name: 'stop', args: {} }],
        ])

        const frames = await collect(
            agent(engine, [user('loop')], { tools: [stop], signal: controller.signal }),
        )

        // Aborting returns without a `done` frame and never drives a second engine turn.
        expect(frames.some((f) => f.type === 'done')).toBe(false)
        expect(engine.turns).toHaveLength(1)
    })
})

describe('rpcTools', () => {
    test('maps an Rpc to a tool whose run invokes the handler', async () => {
        const add = GET((args: { a: number; b: number }) => args.a + args.b)
        const app = await boot({ routes: { add } })

        const surface = rpcTools({ routes: { add } }, app.origin)
        expect(surface).toHaveLength(1)

        const tool = surface[0]
        if (tool === undefined) throw new Error('expected a mapped tool')
        expect(tool.name).toBe('add')

        const result = await tool.run({ a: 2, b: 5 })
        expect(result).toBe(7)
    })

    // THE GATE, not the outcome. `run` used to invoke the rpc callable in-process, and the callable is
    // only the handler — `schemas.input` is validated by the ROUTER, ahead of dispatch. So the schema was
    // advertised to the model and never enforced against what the model sent back, which is the one
    // caller for whom "the args are whatever the caller typed" is not a reasonable assumption.
    //
    // Asserting the throw alone would pass against a `run` that validated and then ran anyway, so the
    // real assertion is that the HANDLER NEVER RAN.
    test('input validation runs — a bad tool call never reaches the handler', async () => {
        let ran = 0
        const setAge = GET(
            (args: { age: number }) => {
                ran += 1
                return args.age
            },
            {
                schemas: {
                    input: {
                        type: 'object',
                        properties: { age: { type: 'number' } },
                        required: ['age'],
                    },
                },
            },
        )
        const app = await boot({ routes: { setAge } })
        const tool = rpcTools({ routes: { setAge } }, app.origin)[0]
        if (tool === undefined) throw new Error('expected a mapped tool')

        // 422 specifically — a bare `toThrow()` would also pass on a connection error, which would be
        // the test guarding nothing.
        await expect(tool.run({ age: 'not a number' })).rejects.toMatchObject({ status: 422 })
        expect(ran).toBe(0)

        // The same tool, called correctly, still works — the gate is a gate, not a wall.
        expect(await tool.run({ age: 41 })).toBe(41)
        expect(ran).toBe(1)
    })

    // The other half of the same hole, and the one CLAUDE.md states as a guarantee: "Reachability, not
    // authorization: a tool that IS reachable still runs its middleware on every call." Per-rpc
    // middleware is composed into the route policy at MOUNT, so an in-process call ran none of it — an
    // rpc whose authorization is its middleware was unauthorized for exactly one caller, a model.
    test('per-rpc middleware runs — a denied tool call never reaches the handler', async () => {
        let ran = 0
        const classified = GET(
            () => {
                ran += 1
                return 'the launch codes'
            },
            { middleware: [() => error(403, 'nope')] },
        )
        const app = await boot({ routes: { classified } })
        const tool = rpcTools({ routes: { classified } }, app.origin)[0]
        if (tool === undefined) throw new Error('expected a mapped tool')

        await expect(tool.run({})).rejects.toMatchObject({ status: 403 })
        expect(ran).toBe(0)
    })

    // The agent surface IS the MCP tool set (machine-surfaces.md MS2.6), so it owes the same
    // reachability answer. It did not give one: `rpcTools` re-derived everything from `route.__rpc`
    // and never read `clients`, so an rpc withheld from every other client surface was still handed
    // to a model as a callable tool.
    test('honours clients.mcp: false — a withheld rpc is not in the tool set', () => {
        const add = GET((args: { a: number; b: number }) => args.a + args.b)
        const secret = GET(() => 'classified', { clients: { mcp: false } })
        const nowhere = GET(() => 'nowhere', { clients: false })

        const names = rpcTools({ routes: { add, secret, nowhere } }, UNUSED_ORIGIN).map(
            (tool) => tool.name,
        )
        expect(names).toEqual(['add'])
    })

    // The doc string and the input schema now come from the registry entry rather than from a second
    // reading of the same options, so a tool description cannot drift from an MCP one.
    test('carries the doc string and a raw JSON input schema from the registry', () => {
        const echo = GET((args: { text: string }) => args.text, {
            doc: 'Echo the text back.',
            schemas: {
                input: { type: 'object', properties: { text: { type: 'string' } } },
            },
        })

        const tool = rpcTools({ routes: { echo } }, UNUSED_ORIGIN)[0]
        if (tool === undefined) throw new Error('expected a mapped tool')
        expect(tool.description).toBe('Echo the text back.')
        expect(tool.inputSchema).toEqual({
            type: 'object',
            properties: { text: { type: 'string' } },
        })
    })
})

// The DEFAULT tool surface (agent.md AG2.2 / DX9). `rpcTools` was correct and orphaned: nothing
// imported it outside this file, so `agent()` ran with an empty tool set while the spec and CLAUDE.md
// both promised the app's `clients.mcp` RPCs. `clients.mcp` is already the gate — declaring it in a
// second place per `agent()` call would be a second concept — so the app PROVIDES the surface at boot
// and naming `tools` is the override.
//
// These drive `agent()` end to end rather than asserting the holder: the failure being guarded is that
// a real loop reaches a real handler, which is the step that was missing.
describe('agent default tool surface', () => {
    async function callsTool(tools?: AgentTool[]): Promise<AgentFrame[]> {
        const engine = mockEngine([
            [{ type: 'tool-call', id: 'c1', name: 'add', args: { a: 2, b: 3 } }],
            [{ type: 'text-delta', text: 'done' }],
        ])
        const options = tools === undefined ? {} : { tools }
        return await collect(agent(engine, [user('add them')], options))
    }

    test('with no app provided, the default is empty — agent() stands alone', async () => {
        const frames = await callsTool()
        // The call resolves to a tool-not-found result rather than a sum: no app, no tools.
        expect(frames.some((f) => f.type === 'tool-result' && String(f.result).includes('5'))).toBe(
            false,
        )
    })

    // Booting the app IS the registration — `createApp` provides the surface itself — so this drives the
    // real wiring end to end rather than hand-registering a look-alike provider.
    test('a booted app supplies its clients.mcp RPCs without the caller naming them', async () => {
        const add = GET((args: { a: number; b: number }) => args.a + args.b)
        await boot({ routes: { add } })

        const frames = await callsTool()
        const result = frames.find((frame) => frame.type === 'tool-result')
        expect(result).toBeDefined()
        expect(String((result as { result: unknown }).result)).toContain('5')
    })

    test('an explicit tools: [] is "no tools", not "give me the default"', async () => {
        const add = GET((args: { a: number; b: number }) => args.a + args.b)
        await boot({ routes: { add } })

        const frames = await callsTool([])
        expect(frames.some((f) => f.type === 'tool-result' && String(f.result).includes('5'))).toBe(
            false,
        )
    })

    // A stopped app must not answer as the next one's default. `provide` returns its own undo and
    // `App.stop()` calls it, so nesting is balanced rather than last-one-wins — which matters because
    // `createTestApp` boots many apps in one process.
    //
    // The baseline is CAPTURED rather than assumed empty. This registry is process-global and the suite
    // shares one process, so another file's live app may be registered underneath — and the previous
    // assertion (`toEqual([])`) only held because the save/restore implementation DESTROYED that
    // registration on withdrawal, which is the defect this pair of tests now pins.
    test('withdrawing restores what was registered beneath it', () => {
        const baseline = defaultAgentSurface().map((tool) => tool.name)
        const outer = GET(() => 'outer')
        const inner = GET(() => 'inner')
        const undoOuter = provideDefaultAgentSurface(() =>
            rpcTools({ routes: { outer } }, UNUSED_ORIGIN),
        )
        const undoInner = provideDefaultAgentSurface(() =>
            rpcTools({ routes: { inner } }, UNUSED_ORIGIN),
        )

        expect(defaultAgentSurface().map((tool) => tool.name)).toEqual(['inner'])
        undoInner()
        expect(defaultAgentSurface().map((tool) => tool.name)).toEqual(['outer'])
        undoInner() // idempotent — a lifecycle backstop may stop twice
        expect(defaultAgentSurface().map((tool) => tool.name)).toEqual(['outer'])
        undoOuter()
        expect(defaultAgentSurface().map((tool) => tool.name)).toEqual(baseline)
    })

    // THE REASON IT IS A STACK AND NOT A SAVE/RESTORE PAIR. `createTestApp` hands each caller its own
    // `stop()`, and test files run in parallel, so the undos do NOT reliably run in reverse. With a
    // `previous` local, `undoFirst()` restores first's own previous (nothing) OVER second, and
    // `undoSecond()` then reinstalls the STOPPED first — both of the failures the module's comment
    // claims are prevented, in the one interleaving it is most likely to meet.
    test('withdrawing OUT OF ORDER neither unregisters the live app nor revives the stopped one', () => {
        const baseline = defaultAgentSurface().map((tool) => tool.name)
        const first = GET(() => 'first')
        const second = GET(() => 'second')
        const undoFirst = provideDefaultAgentSurface(() =>
            rpcTools({ routes: { first } }, UNUSED_ORIGIN),
        )
        const undoSecond = provideDefaultAgentSurface(() =>
            rpcTools({ routes: { second } }, UNUSED_ORIGIN),
        )

        undoFirst() // the OUTER one stops while the inner is still live
        expect(defaultAgentSurface().map((tool) => tool.name)).toEqual(['second'])
        undoSecond()
        expect(defaultAgentSurface().map((tool) => tool.name)).toEqual(baseline)
    })
})
