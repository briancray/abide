import { GET } from "abide/server/GET"

// A tiny read RPC used by the control-flow "async reads" page: an `{#await controlGreet(...)}`
// block resolves this value during SSR so the greeting lands directly in the initial HTML.
export default GET(
  ({ who = "reader" }: { who?: string }) => `Hello, ${who} — resolved on the server.`,
)
