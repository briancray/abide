// #demo platformLog
import { GET } from "abide/server/GET"
import { log } from "abide/shared/log"

// `log()` is server-side structured logging. `log.channel(name)` returns a namespaced logger (gated
// by the `DEBUG` env var, debug-npm style), and the level methods (`.info` / `.warn` / `.error` /
// `.trace`) pick the stream + level. The lines land on the SERVER console — never in the browser —
// so this RPC does the logging server-side and returns the FACT that it logged for the UI to show.
export default GET(({ message = "hello from the docs" }: { message?: string }) => {
  const channel = log.channel("docs")
  channel.info("card log (info)", { message })
  log.warn("card log (warn)", { message })
  return { logged: true, channel: "docs", levels: ["info", "warn"], message }
})
// #enddemo
