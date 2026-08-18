import { onConfig } from 'abide/server'

/**
 * The middle layer: abide's floor, then this, then what the operator declared.
 *
 * The app's layer LOSING to the environment is what makes it a default rather than a knob that does
 * nothing — and the hook is handed the environment already assembled, so a default may be computed from
 * one without a null check of its own.
 *
 * A REGISTRATION, made where the app's module runs: one process has one answer, so a second call
 * replaces the first and `packages/dogfood/app.ts` is the single place that makes it. Carrying exactly
 * this is why the preview beside it has a value to read back rather than a description of one. A
 * second argument — `onConfig(hook, { schema })` — is how a key an app cannot work without is declared.
 */
onConfig(() => ({ DOCS_GREETING: 'hello' }))
