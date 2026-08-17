/**
 * Merged OVER the baseline, so the app wins every field it names.
 *
 * A reporter that throws becomes an account of not working — `error` in the document and a 503 off that
 * one field — rather than a route falling over, which is exactly the case a health check exists for.
 *
 * An app EXPORT, which is the form the boot registers: one process has one account of itself, so a
 * second reporter would replace the first. `packages/dogfood/app.ts` carries this one, which is why
 * the preview beside it reads a real `example` back.
 */
export function onHealth(): unknown {
    return { example: { serving: true, queued: 0 } }
}
