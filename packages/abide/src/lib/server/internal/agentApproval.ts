// agentApproval — the socket-mux transport for the agent tool-approval decision (agent.md AG2.5,
// TODO #10 DECIDED). A running loop that needs a decision publishes an approval REQUEST on a
// per-run `(agentRun, toolCallId)` channel and awaits a DECISION message published back on that
// same channel. Each channel is a `SocketHub` — the identical bounded fanout that backs cache-
// broadcast channels and named user sockets; no new transport is invented, the decision rides the
// same mux.
//
// The core loop only needs `decide` to be some `(request) => Promise<ApprovalDecision>`, so this
// module is entirely optional wiring: `muxApprovalDecider(runId)` produces the production `decide`,
// and `publishApprovalDecision(...)` is the wire path a UI/approver (over the mux HTTP/WS face)
// calls to resolve a pending approval.

import { SocketHub } from "./socketHub.ts";
import type { ApprovalDecision, ApprovalRequest } from "./agentTypes.ts";

// Reserved `@agent:` namespace — distinct from `@rpc:` / `@tag:` cache channels and bare user
// socket names (which never carry `@`/`:`), so an approval channel can never collide with either.
const AGENT_APPROVAL_PREFIX = "@agent:";

// Deterministic channel name for one run's tool call. Stable per `(runId, toolCallId)`.
export function agentApprovalChannelName(runId: string, toolCallId: string): string {
  return AGENT_APPROVAL_PREFIX + runId + ":" + toolCallId;
}

// One frame on an approval channel: the loop publishes a `request`, an approver publishes a
// `decision`. Monomorphic union on `kind`.
export type ApprovalChannelFrame =
  | { kind: "request"; request: ApprovalRequest }
  | { kind: "decision"; id: string; decision: ApprovalDecision };

// Lazy per-channel hubs keyed by channel name. A short tail lets an approver that subscribes AFTER
// the loop published the request still replay the pending request (a channel is per-toolCallId, so
// it carries exactly one request in its lifetime — no stale cross-talk).
const channels = new Map<string, SocketHub<ApprovalChannelFrame>>();

export function agentApprovalHub(name: string): SocketHub<ApprovalChannelFrame> {
  let hub = channels.get(name);
  if (hub === undefined) {
    hub = new SocketHub<ApprovalChannelFrame>({ tail: 64 });
    channels.set(name, hub);
  }
  return hub;
}

// Publish a decision back onto a run's `(agentRun, toolCallId)` channel — the wire path a UI /
// approver calls to resolve a pending approval.
export function publishApprovalDecision(runId: string, toolCallId: string, decision: ApprovalDecision): void {
  const hub = agentApprovalHub(agentApprovalChannelName(runId, toolCallId));
  hub.publish({ kind: "decision", id: toolCallId, decision });
}

// The production `decide` for one agent run: publishes the approval request on the run's
// `(agentRun, toolCallId)` channel, then awaits the first decision message published back on it.
export function muxApprovalDecider(runId: string): (request: ApprovalRequest) => Promise<ApprovalDecision> {
  return async (request: ApprovalRequest): Promise<ApprovalDecision> => {
    const hub = agentApprovalHub(agentApprovalChannelName(runId, request.id));
    const iterator = hub.subscribe();
    // Publish AFTER subscribing so a decision can't race ahead of our own listener.
    hub.publish({ kind: "request", request });
    try {
      while (true) {
        const next = await iterator.next();
        if (next.done) return { action: "deny", reason: "approval channel closed" };
        const frame = next.value;
        if (frame.kind === "decision" && frame.id === request.id) return frame.decision;
      }
    } finally {
      await iterator.return?.();
    }
  };
}
