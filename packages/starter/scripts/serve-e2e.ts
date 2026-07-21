// Serve the starter app on a fixed port for Playwright e2e runs. Uses the same `serve` entry the CLI
// uses (dev mode = live-reload + SSR) so tests drive the real scaffolded app, not a mock. This is the
// dogfood gate: if `abide scaffold`'s output stops building/rendering, this suite goes red.
import { serve } from '../../abide/src/cli/serve.ts'

// A fixed test secret so `identity.set()` never warns during the run. Not a real secret.
process.env.ABIDE_IDENTITY_SECRET ??= 'e2e-test-secret-not-for-production'

const port = Number(process.env.PORT ?? 4322)
const dir = new URL('..', import.meta.url).pathname

const { url } = await serve(dir, { dev: true, port })
console.info(`[e2e] starter app serving at ${url}`)
