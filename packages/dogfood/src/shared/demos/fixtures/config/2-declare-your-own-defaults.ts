/**
 * The middle layer: abide's floor, then this, then what the operator declared.
 *
 * The app's layer LOSING to the environment is what makes it a default rather than a knob that does
 * nothing — and the hook is handed the environment already assembled, so a default may be computed from
 * one without a null check of its own.
 *
 * An app EXPORT rather than a call, which is the form the boot registers for you: one process has one
 * answer, so a second registration replaces the first and the boot is the single place to make it.
 * `packages/dogfood/app.ts` carries exactly this, which is why the preview beside it has a value to
 * read back rather than a description of one.
 */
export function onConfig(): Record<string, unknown> {
    return { DOCS_GREETING: 'hello' }
}
