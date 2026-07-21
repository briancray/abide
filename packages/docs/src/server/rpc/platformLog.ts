// #demo platformLog
import { GET } from 'abide/server/GET'
import { log } from 'abide/shared/log'

// `log` is isomorphic structured logging. Every line is labeled with a CHANNEL. The bare `log(...)`
// (and `.info` / `.warn` / `.error` / `.trace`) uses the DEFAULT channel — the app name ("docs" here,
// from package.json) — and is ALWAYS ON. `log.channel(name)` names a channel gated by the `DEBUG` env
// var (debug-npm style: `DEBUG=docs:cards` or `DEBUG=*`; the browser reads `localStorage.debug`), so
// framework internals (`abide:*`) and verbose app channels stay quiet until asked for. One exception:
// `error` always emits, even on a gated channel. These lines land on the SERVER console here, so the
// RPC returns the FACT that it logged for the UI to show.
export default GET(({ message = 'hello from the docs' }) => {
    log.info('card log (info)', { message }) // default "docs" channel — always on
    log.channel('docs:cards').trace('verbose card detail', { message }) // gated: DEBUG=docs:cards
    return {
        logged: true,
        channel: 'docs',
        gated: 'docs:cards',
        levels: ['info', 'trace'],
        message,
    }
})
// #enddemo
