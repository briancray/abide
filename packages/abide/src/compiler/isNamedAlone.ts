/**
 * One character that can continue a JavaScript identifier: `\p{ID_Continue}`, `$`, and the two
 * joiners. What every "is this the middle of a name" test reads, so a name spelled outside ASCII
 * is one name everywhere.
 */
export const IDENTIFIER_PART = /[\p{ID_Continue}$\u200c\u200d]/u

const NAMED_ALONE = new RegExp(
    `^[\\p{ID_Start}$_]${IDENTIFIER_PART.source}*$`,
    'u',
)

/**
 * Whether `subject` is one identifier and nothing else.
 *
 * The case 32.32 keys by the value's own `by`, and a component tag a call can spell
 * (`projectShadow`).
 */
export function isNamedAlone(subject: string): boolean {
    return NAMED_ALONE.test(subject)
}
