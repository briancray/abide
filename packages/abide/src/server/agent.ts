// agent() — the provider-neutral agent LOOP (agent.md AG1.5). Given an `AgentEngine`, a starting
// transcript, and options, it runs the full tool-use cycle internally: LLM turn → any tool-call
// frames → execute each tool in-process → tool-result frames → append to the transcript → next LLM
// turn → … until a turn produces no tool calls, then a final `done` frame. Every frame streams out
// as it happens (a normal §12 stream, consumed isomorphically). The loop is provider-agnostic; the
// engine normalizes its provider into `AgentFrame`s.
//
// Stateless (AG2.4): the caller's `messages` array is never mutated — the running transcript is a
// local copy the loop grows across turns. Cancellation (AG2.3): `options.signal` aborts the loop.
//
// Engine (non-app) tools are OUT here (AG2.5, off by default) — this loop only executes tools in
// the provided `AgentSurface`, which are the app's own RPCs gated by the app's middleware (AG1.7).

import { raceAbort } from '../shared/internal/withAbort.ts'
import type {
    AgentEngine,
    AgentFrame,
    AgentOptions,
    AgentTool,
    ApprovalDecision,
    ApprovalPolicy,
    NeutralContentPart,
    NeutralMessage,
} from './internal/agentTypes.ts'
import { defaultAgentSurface } from './internal/defaultAgentSurface.ts'

export type {
    AgentEngine,
    AgentFrame,
    AgentOptions,
    AgentSurface,
    AgentTool,
    ApprovalDecision,
    ApprovalPolicy,
    ApprovalRequest,
    NeutralContentPart,
    NeutralMessage,
} from './internal/agentTypes.ts'

export async function* agent(
    engine: AgentEngine,
    messages: NeutralMessage[],
    options: AgentOptions = {},
): AsyncIterable<AgentFrame> {
    const signal = options.signal
    // The tool surface for this run (AG2.2, DX9): the DEFAULT is the app's own `clients.mcp` RPCs, and
    // naming `tools` is the OVERRIDE (`[]` = none, `[...]` = a subset). `clients.mcp` is already the
    // gate — an agent's tool set IS the MCP tool set (MS2.6) — so an rpc withheld from MCP is withheld
    // here, by the same declaration every other machine client reads, and there is no second place to
    // say it. Availability is not authorization either way: an app tool that IS reachable still runs
    // its own middleware on every call (AG1.7).
    //
    // `defaultAgentSurface()` is a leaf the booted app PROVIDES into (`createApp`), not a registry this
    // module reaches for — `agent()` stays usable with no app config at all, where the answer is `[]`.
    // `?? ` and not `|| `: an explicit `tools: []` is "no tools", not "give me the default".
    const tools: AgentTool[] = options.tools ?? defaultAgentSurface()

    // The running transcript — a local copy so the caller's array is never mutated (AG2.4).
    const transcript: NeutralMessage[] = messages.slice()

    while (true) {
        if (signal?.aborted) return

        const toolCalls: { id: string; name: string; args: unknown }[] = []

        for await (const frame of engine.stream(transcript, tools, options)) {
            if (signal?.aborted) return
            // `message-stop` is the engine's turn boundary — consumed by the loop, not surfaced. The
            // loop, not the engine, decides `done`.
            if (frame.type === 'message-stop') break
            yield frame
            if (frame.type === 'tool-call')
                toolCalls.push({ id: frame.id, name: frame.name, args: frame.args })
        }

        if (signal?.aborted) return

        // No tool calls → the exchange is complete.
        if (toolCalls.length === 0) {
            yield { type: 'done' }
            return
        }

        // Approval gate (AG2.5): resolve each call to its EFFECTIVE args (edited args replace the
        // model's) or a denial before anything runs. When the policy gates a call the loop surfaces an
        // `approval-request` frame and awaits a decision over the injected transport; the resolution is
        // surfaced as an `approval-decision` frame. Aborting while awaiting a decision returns cleanly.
        const resolved: {
            call: { id: string; name: string; args: unknown }
            effectiveArgs: unknown
            denied: boolean
            reason?: string
        }[] = []
        const policy = options.approval
        for (const call of toolCalls) {
            if (signal?.aborted) return

            if (policy === undefined || !approvalRequired(policy, call)) {
                resolved.push({ call, effectiveArgs: call.args, denied: false })
                continue
            }

            yield { type: 'approval-request', id: call.id, name: call.name, args: call.args }
            const decision = await awaitDecision(
                policy,
                { id: call.id, name: call.name, args: call.args },
                signal,
            )
            if (signal?.aborted || decision === ABORTED) return
            yield { type: 'approval-decision', id: call.id, action: decision.action }

            if (decision.action === 'deny') {
                resolved.push(
                    decision.reason === undefined
                        ? { call, effectiveArgs: call.args, denied: true }
                        : { call, effectiveArgs: call.args, denied: true, reason: decision.reason },
                )
            } else if (decision.action === 'edit') {
                resolved.push({ call, effectiveArgs: decision.args, denied: false })
            } else {
                resolved.push({ call, effectiveArgs: call.args, denied: false })
            }
        }

        // Record the model's tool-use turn as one assistant message carrying every tool-use part —
        // reflecting the EFFECTIVE args, so an edited call is faithfully recorded in the transcript.
        const toolUseParts: NeutralContentPart[] = []
        for (const entry of resolved) {
            toolUseParts.push({
                type: 'tool-use',
                id: entry.call.id,
                name: entry.call.name,
                args: entry.effectiveArgs,
            })
        }
        transcript.push({ role: 'assistant', content: toolUseParts })

        // Execute each approved tool in-process, emit a tool-result frame, and append a tool message.
        // A denied call is NOT run — it surfaces a denial as an error tool-result so the model sees it.
        for (const entry of resolved) {
            if (signal?.aborted) return
            const call = entry.call

            let result: unknown
            let error: unknown
            let threw = false

            if (entry.denied) {
                threw = true
                error = new Error(
                    entry.reason ? `tool call denied: ${entry.reason}` : 'tool call denied',
                )
            } else {
                const tool = findTool(tools, call.name)
                if (tool === undefined) {
                    threw = true
                    error = new Error(`unknown tool: ${call.name}`)
                } else {
                    try {
                        result = await tool.run(entry.effectiveArgs)
                    } catch (caught) {
                        threw = true
                        error = caught
                    }
                }
            }

            if (threw) {
                yield { type: 'tool-result', id: call.id, result: undefined, error }
                transcript.push({
                    role: 'tool',
                    content: [{ type: 'tool-result', id: call.id, result: undefined, error }],
                })
            } else {
                yield { type: 'tool-result', id: call.id, result }
                transcript.push({
                    role: 'tool',
                    content: [{ type: 'tool-result', id: call.id, result }],
                })
            }
        }
        // Loop: run another engine turn with the grown transcript.
    }
}

function findTool(tools: AgentTool[], name: string): AgentTool | undefined {
    for (const tool of tools) {
        if (tool.name === name) return tool
    }
    return undefined
}

// Does this call need an approval decision? Omitted `required` gates every call (supplying a policy
// signals intent to gate); a boolean is all/none; a predicate decides per call.
function approvalRequired(
    policy: ApprovalPolicy,
    call: { id: string; name: string; args: unknown },
): boolean {
    const required = policy.required
    if (required === undefined) return true
    if (typeof required === 'function') return required(call)
    return required
}

// Sentinel returned when the signal aborts before a decision resolves — lets the loop return without
// mistaking the abort for a real decision.
const ABORTED: unique symbol = Symbol('abide.agent.approval.aborted')

// Await the transport's decision, but resolve to ABORTED the moment the signal fires — so a pending
// approval (a decision that may never arrive) can't wedge the loop past an abort (AG2.3).
//
// The RACE is `raceAbort`'s, shared with `withAbort`; only the terminal is this file's. An abandoned
// approval is a decision the loop can act on, not an error, so it resolves the sentinel where an
// abandoned rpc read rejects — and the swallow-the-underlying-rejection rule that was discovered here
// now lives with the race rather than beside one of its two callers.
function awaitDecision(
    policy: ApprovalPolicy,
    request: { id: string; name: string; args: unknown },
    signal: AbortSignal | undefined,
): Promise<ApprovalDecision | typeof ABORTED> {
    return raceAbort<ApprovalDecision | typeof ABORTED>(
        policy.decide(request),
        signal,
        () => ABORTED,
    )
}
