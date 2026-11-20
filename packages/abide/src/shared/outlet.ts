// 50.36 — AN OUTLET: requests made anywhere, shown by the ONE component of a kind standing in the
// page — the last bound of those standing, so a second `Toasts` or `Prompts` a nested layout renders
// shows nothing rather than a second copy of every notice or a second modal over the first. What is
// asked for, and in what order it shows, is the caller's: one hint, a list of notices, a queue of
// prompts. A request no component stands to show is lost without a word, so the first warns.

import { namedLogger } from './log.ts'
import { reactive } from './reactive/index.ts'
import { join } from './register.ts'

/**
 * The hosts standing for one kind of component, and the warning it gives once where a request finds
 * none.
 *
 * @param component the component that shows the requests, as an app renders it: `'<Toasts />'`
 * @param logger the logger the warning is written on: `'abide:toasts'`
 */
export function outlet(component: string, logger: string) {
    // One per request on a server, as every `reactive` without `global` is (11.32).
    const hosts = reactive<readonly object[]>([])
    const log = namedLogger(logger)
    let warned = false
    return {
        /**
         * Stands the calling component as a host until it is removed, handing back whether it is the
         * one that shows. Called from the component's own `<script>`.
         */
        stand(): () => boolean {
            const host = {}
            join(hosts, host)
            return () => hosts().at(-1) === host
        },
        /**
         * Warns once where a request is made with no host standing to show it — looked at a microtask
         * on, since a root layout renders its host after the `<slot />` whose page may ask while it
         * mounts, and the host stands in that same mount.
         */
        asked(): void {
            if (warned) return
            queueMicrotask(() => {
                if (warned || (hosts.peek()?.length ?? 0) > 0) return
                warned = true
                log.warning(
                    `a request was made with no ${component} rendered to show it — render one in the root layout. RULEBOOK 50.36.`,
                )
            })
        },
    }
}
