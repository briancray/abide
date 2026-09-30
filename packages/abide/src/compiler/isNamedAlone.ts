/**
 * Whether `subject` is one identifier and nothing else.
 *
 * The case 32.32 keys by the value's own `by`, and a component tag a call can spell
 * (`projectShadow`).
 */
export function isNamedAlone(subject: string): boolean {
    return /^[\p{ID_Start}$_][\p{ID_Continue}$\u200c\u200d]*$/u.test(subject)
}
