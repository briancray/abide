// Server-Sent Events streaming response (rpc-core §4). Emits a `data: <json>\n\n` frame
// per item from a sync or async iterable, streamed through a ReadableStream.
//
// A long-lived subscription (e.g. a `socket(...)` HTTP face) can stay byte-idle indefinitely
// between messages. Bun would idle-time-out that connection, so we emit a periodic SSE comment
// (`:\n\n`, ignored by every EventSource) to keep bytes flowing. The heartbeat fires only after
// HEARTBEAT_MS of silence, so a finite iterable that drains promptly never emits one. `cancel`
// (client disconnect) tears the interval down AND returns the source iterator, so a subscribing
// iterable (the socket hub) drops the subscriber instead of leaking it.

const HEARTBEAT_MS = 15_000;
const HEARTBEAT = new TextEncoder().encode(":\n\n");

// NOTE: sse() is NOT yet a see-through/replayable helper (unlike json/jsonl) — it stays an opaque
// Response (eager, heartbeat-driven, battle-tested for long-lived socket faces). Making `GET(() =>
// sse(gen()))` replayable like an async generator needs a lazy (pull-based, HWM 0) sse — a follow-up.
export function sse(iterable: AsyncIterable<unknown> | Iterable<unknown>, init?: ResponseInit): Response {
  const encoder = new TextEncoder();
  let source: AsyncIterator<unknown> | Iterator<unknown> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const stopHeartbeat = (): void => {
    if (heartbeat !== undefined) {
      clearInterval(heartbeat);
      heartbeat = undefined;
    }
  };
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const asAsync = iterable as AsyncIterable<unknown>;
      source = asAsync[Symbol.asyncIterator]?.() ?? (iterable as Iterable<unknown>)[Symbol.iterator]();
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(HEARTBEAT);
        } catch {
          stopHeartbeat();
        }
      }, HEARTBEAT_MS);
      try {
        for (let result = await source.next(); result.done !== true; result = await source.next()) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(result.value)}\n\n`));
        }
        stopHeartbeat();
        controller.close();
      } catch (caught) {
        stopHeartbeat();
        controller.error(caught);
      }
    },
    // Client disconnected: stop the heartbeat and release the source iterator so a subscribing
    // hub removes this subscriber (no leak).
    async cancel() {
      stopHeartbeat();
      await source?.return?.(undefined);
    },
  });
  const headers = new Headers(init?.headers);
  if (!headers.has("content-type")) headers.set("content-type", "text/event-stream");
  return new Response(stream, { ...init, headers });
}
