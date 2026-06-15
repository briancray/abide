import { canonicalJson } from './canonicalJson.ts'
import { createLivenessWatch } from './createLivenessWatch.ts'
import { createSubscriber } from './createSubscriber.ts'
import { HEALTH_PATH } from './HEALTH_PATH.ts'
import { healthReadSlot } from './healthReadSlot.ts'
import { healthSeedSlot } from './healthSeedSlot.ts'
import { isBelteHealthPayload } from './isBelteHealthPayload.ts'
import { withBase } from './withBase.ts'

/*
Augmented by the generated `src/.belte/health.d.ts` with
`{ fields: <the app health() hook's resolved return> }`, so a project's
`health()` reads type against its own hook. Unaugmented (no app.ts, or no
hook), AppHealth resolves to no fields.
*/
// @readme observability
// biome-ignore lint/suspicious/noEmptyInterface: augmented by the generated health.d.ts
export interface AppHealthMap {}
export type AppHealth = AppHealthMap extends { fields: infer Fields }
    ? Fields extends object
        ? Fields
        : Record<never, never>
    : Record<never, never>

/*
What health() reports: `reachable` is the framework's transport verdict; the
rest is the last successful payload, whole — the framework identity (`belte`
carries the framework version, `name`/`version` the app's) plus the app
health() hook's fields, exactly as /__belte/health serves them. Fields
persist while unreachable (last-known state beats vanishing fields: "was
authenticated, currently unreachable" and "reachable, not authenticated"
need different UI) and are Partial because nothing has arrived before the
first poll — unless the SSR seed shipped them with the document.
*/
export type HealthState = {
    reachable: boolean
    belte?: string
    name?: string
    version?: string
} & Partial<AppHealth>

const PROBE_INTERVAL_MS = 10_000
const PROBE_TIMEOUT_MS = 5_000

/* Last successful payload's app fields (framework identity keys stripped). */
let fields: Record<string, unknown> = {}
/* The watch's verdict; composed with navigator.onLine at read time. */
let backendAlive = true
let notify: (() => void) | undefined

/*
One probe: the same standard of proof as the launcher's probeBelteServer —
a `belte` key in the body, never response.ok alone, because a captive
portal answers any GET with a 200. Captures the whole payload (identity
keys included) as a side effect; a changed payload (e.g. authenticated
flipping) notifies readers even though reachability didn't transition.
*/
async function probeHealth(url: string): Promise<boolean> {
    try {
        const response = await fetch(url, {
            headers: { accept: 'application/json' },
            cache: 'no-store',
            signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        })
        if (!response.ok) {
            return false
        }
        const body = (await response.json()) as Record<string, unknown>
        if (!isBelteHealthPayload(body)) {
            return false
        }
        applyFields(body)
        return true
    } catch {
        return false
    }
}

/* Swaps in a changed payload and notifies readers; identical payloads stay silent. */
function applyFields(payload: Record<string, unknown>): void {
    if (canonicalJson(payload) !== canonicalJson(fields)) {
        fields = payload
        notify?.()
    }
}

const watch = createLivenessWatch({
    probe: probeHealth,
    onChange(alive) {
        backendAlive = alive
        notify?.()
    },
    intervalMs: PROBE_INTERVAL_MS,
})

/*
Reader-driven lifecycle (the createSubscriber rule): the first tracking
reader starts the poll, the last one tears it down — an app that never
reads health() never sends a byte. Mirrors the socket channel's visibility
philosophy: hidden tabs hold no poll (nobody is looking at the banner),
and the visible transition probes immediately so the value is honest the
moment eyes return. The online event also probes immediately — recovery
confirmation shouldn't wait out the interval; offline needs no probe
because read-time composition with navigator.onLine reports it instantly.
*/
const subscribeHealth =
    typeof window === 'undefined'
        ? undefined
        : createSubscriber((update) => {
              notify = update
              const onVisibility = () => {
                  if (document.visibilityState === 'hidden') {
                      watch.stop()
                      return
                  }
                  watch.watch(withBase(HEALTH_PATH))
                  watch.probeNow()
              }
              const onOnline = () => {
                  watch.probeNow()
                  update()
              }
              const onOffline = () => update()
              document.addEventListener('visibilitychange', onVisibility)
              window.addEventListener('online', onOnline)
              window.addEventListener('offline', onOffline)
              watch.watch(withBase(HEALTH_PATH))
              /*
              SSR seed: a page that read health() during its server render
              shipped the payload in __SSR__ (startClient parks it on the
              slot). The document's arrival just proved the server
              reachable, so the immediate first probe is skipped — the
              watch's interval owns the next one — and the fields apply a
              microtask after connect: the hydration read still matches the
              server-rendered DOM (the server render carried no fields),
              while the update lands before first paint. Consumed once;
              later reconnects probe immediately as usual.
              */
              const seed = healthSeedSlot.payload
              healthSeedSlot.payload = undefined
              if (seed) {
                  queueMicrotask(() => applyFields(seed))
              } else {
                  watch.probeNow()
              }
              return () => {
                  document.removeEventListener('visibilitychange', onVisibility)
                  window.removeEventListener('online', onOnline)
                  window.removeEventListener('offline', onOffline)
                  watch.stop()
                  notify = undefined
              }
          })

/*
Reactive backend-health read: `reachable` plus whatever the app's
health(request) hook reports, polled from /__belte/health only while a
tracking scope ($derived/$effect) is reading it. Like tail and cache —
and unlike the pending()/refreshing() probes — reading this opens a
resource (the poll). Constant `{ reachable: true }` on the server: the
server is its own backend. navigator.onLine composes in at read time, so
a lost network reports instantly without waiting for a probe to time out.
*/
export function health(): HealthState {
    /* window, not navigator: Bun defines a partial navigator with no onLine. */
    if (typeof window === 'undefined') {
        /*
        Mark the request (when the server runtime installed a marker) so the
        renderer stamps the health payload into __SSR__ — the client's seed.
        The render itself stays fields-less: the hook may be async and this
        read is sync, so the payload is built after the render returns.
        */
        healthReadSlot.mark?.()
        return { reachable: true } as HealthState
    }
    subscribeHealth?.()
    /* reachable last: it is the framework's verdict, never a hook field's to shadow. */
    return { ...fields, reachable: backendAlive && navigator.onLine } as HealthState
}
