// Reads a field that exists ONLY because the generated companion augmented health(). Without
// `src/.abide/health.d.ts` in the program this file does not compile — which is the assertion.
import { health } from 'abide/shared/health'

export async function probe(): Promise<string> {
    const document = await health()
    return `${document.db}:${document.queueDepth}:${document.version}:${document.uptime}`
}
