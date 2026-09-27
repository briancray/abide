// A subject that is one identifier and nothing else — the case 32.33 keys by the value's own `by`.
export function isNamedAlone(subject: string): boolean {
    return /^[\p{ID_Start}$_][\p{ID_Continue}$\u200c\u200d]*$/u.test(subject)
}
