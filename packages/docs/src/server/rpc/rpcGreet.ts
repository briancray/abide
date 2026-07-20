import { GET } from "abide/server/GET"

// A read RPC used across the rpc-bucket pages to demonstrate the three async-read template forms
// ({fn()} peek, {await fn()}, {#await}) and the raw-fetch bypass. Returns a plain value; the router
// serializes it with json(), so the same call is cached in-proc on SSR and a fetch in the browser.
export default GET(({ name = "world" }: { name?: string }) => ({
  greeting: `Hello, ${name}!`,
  length: name.length,
  at: new Date(2026, 0, 1).toISOString(),
}))
