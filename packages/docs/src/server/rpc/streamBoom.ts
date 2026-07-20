import { GET } from "abide/server/GET"

// A slow read that REJECTS — pairs with a `{#await}{:catch}` to show that a streamed subtree which
// errors after the shell flushed streams its `{:catch}` branch as the patch (streaming-ssr-plan PR5),
// and the client hydrates that catch branch in place. The declared return type keeps the output schema
// representable even though the handler always throws.
export default GET(async (): Promise<{ ok: boolean }> => {
  await Bun.sleep(120)
  throw new Error("stream boom — the read rejected")
})
