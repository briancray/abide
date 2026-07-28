import { describe, expect, test } from 'bun:test'
import { mockEngine } from '../test/mockEngine.ts'
import { agent } from './agent.ts'
import { GET } from './GET.ts'
import type { AgentFrame, AgentTool, NeutralMessage } from './internal/agentTypes.ts'
import { defaultAgentSurface, provideDefaultAgentSurface } from './internal/defaultAgentSurface.ts'
import { rpcTools } from './internal/rpcTools.ts'

async function collect(stream: AsyncIterable<AgentFrame>): Promise<AgentFrame[]> {
    const frames: AgentFrame[] = []
    for await (const frame of stream) frames.push(frame)
    return frames
}

function user(text: string): NeutralMessage {
    return { role: 'user', content: text }
}

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

        const surface = rpcTools({ routes: { add } })
        expect(surface).toHaveLength(1)

        const tool = surface[0]
        if (tool === undefined) throw new Error('expected a mapped tool')
        expect(tool.name).toBe('add')

        const result = await tool.run({ a: 2, b: 5 })
        expect(result).toBe(7)
    })

    // The agent surface IS the MCP tool set (machine-surfaces.md MS2.6), so it owes the same
    // reachability answer. It did not give one: `rpcTools` re-derived everything from `route.__rpc`
    // and never read `clients`, so an rpc withheld from every other client surface was still handed
    // to a model as a callable tool.
    test('honours clients.mcp: false — a withheld rpc is not in the tool set', () => {
        const add = GET((args: { a: number; b: number }) => args.a + args.b)
        const secret = GET(() => 'classified', { clients: { mcp: false } })
        const nowhere = GET(() => 'nowhere', { clients: false })

        const names = rpcTools({ routes: { add, secret, nowhere } }).map((tool) => tool.name)
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

        const tool = rpcTools({ routes: { echo } })[0]
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

    test('a booted app supplies its clients.mcp RPCs without the caller naming them', async () => {
        const add = GET((args: { a: number; b: number }) => args.a + args.b)
        const withdraw = provideDefaultAgentSurface(() => rpcTools({ routes: { add } }))
        try {
            const frames = await callsTool()
            const result = frames.find((frame) => frame.type === 'tool-result')
            expect(result).toBeDefined()
            expect(String((result as { result: unknown }).result)).toContain('5')
        } finally {
            withdraw()
        }
    })

    test('an explicit tools: [] is "no tools", not "give me the default"', async () => {
        const add = GET((args: { a: number; b: number }) => args.a + args.b)
        const withdraw = provideDefaultAgentSurface(() => rpcTools({ routes: { add } }))
        try {
            const frames = await callsTool([])
            expect(
                frames.some((f) => f.type === 'tool-result' && String(f.result).includes('5')),
            ).toBe(false)
        } finally {
            withdraw()
        }
    })

    // A stopped app must not answer as the next one's default. `provide` returns its own undo and
    // `App.stop()` calls it, so nesting is balanced rather than last-one-wins — which matters because
    // `createTestApp` boots many apps in one process.
    test('withdrawing restores the previous provider rather than clearing it', () => {
        const outer = GET(() => 'outer')
        const inner = GET(() => 'inner')
        const undoOuter = provideDefaultAgentSurface(() => rpcTools({ routes: { outer } }))
        const undoInner = provideDefaultAgentSurface(() => rpcTools({ routes: { inner } }))

        expect(defaultAgentSurface().map((tool) => tool.name)).toEqual(['inner'])
        undoInner()
        expect(defaultAgentSurface().map((tool) => tool.name)).toEqual(['outer'])
        undoInner() // idempotent — a lifecycle backstop may stop twice
        expect(defaultAgentSurface().map((tool) => tool.name)).toEqual(['outer'])
        undoOuter()
        expect(defaultAgentSurface()).toEqual([])
    })
})
