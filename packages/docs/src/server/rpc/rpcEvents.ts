import { GET } from "abide/server/GET"
import { sse } from "abide/server/sse"

// A streaming read over Server-Sent Events. The handler returns an `sse` Response (each item becomes a
// `data: <json>\n\n` frame); the browser reads the `text/event-stream` and renders frames as they land.
export default GET(({ count = 3 }: { count?: number }) => {
  async function* events(): AsyncIterable<{ seq: number; kind: string }> {
    for (let seq = 1; seq <= count; seq++) {
      await new Promise((resolve) => setTimeout(resolve, 25))
      yield { seq, kind: seq === count ? "final" : "progress" }
    }
  }
  return sse(events())
})
