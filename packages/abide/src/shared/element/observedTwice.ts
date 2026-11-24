/**
 * 32.92 — throws for a second element part of one kind on one element: the observer keeps one
 * target per element, and a second would take the first one's deliveries and its teardown.
 */
export function observedTwice(kind: string, element: Element): never {
    throw new Error(
        `abide: <${element.localName}> is measured by ${kind} twice — one element takes one ${kind}; write its value from one callback. RULEBOOK 32.92.`,
    )
}
