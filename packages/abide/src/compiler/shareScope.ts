import type { Lowering } from './Lowering.ts'

// Where a deferred level holds the share scope its setup ran in (41.19), for its build to resume.
export const SETTLED_AT = '__settledAt'

// The share scope an instance opens (10.5), named apart from the client's binding `Scope`: one is
// what a component's descendants look a key up through, the other is what stops its bindings.
const SHARED = '__shared'

/**
 * The emitted lines that open and close the instance's own share scope, or two empty strings.
 *
 * 10.5 — opened around everything the instance does on either side, or nothing where it shares
 * nothing. Closed in a `finally`, so an instance that threw leaves the scope it entered.
 */
export function shareScope(
    lowering: Lowering,
    indent: string,
): { opened: string; closed: string } {
    if (!lowering.opensShareScope()) return { opened: '', closed: '' }
    return {
        opened: `${indent}const ${SHARED} = ${lowering.use('enterShare')}()\n${indent}try {\n`,
        closed: `\n${indent}} finally { ${lowering.use('leaveShare')}(${SHARED}) }`,
    }
}

/**
 * The emitted statements that put the share scope held in `at` back and leave it again.
 *
 * 10.5 — for work that runs later than the instance it belongs to, with that instance's scope no
 * longer current. The leave goes in a `finally`, wherever the caller's `try` is.
 */
export function resumedShare(
    lowering: Lowering,
    at: string,
): { resume: string; leave: string } {
    return {
        resume: `const __back = ${lowering.use('resumeShare')}(${at})`,
        leave: `${lowering.use('leaveShare')}(__back)`,
    }
}

/** `body` run inside the share scope held in `at`, which it leaves in a `finally` (`resumedShare`). */
export function insideShare(
    lowering: Lowering,
    at: string,
    body: string,
): string {
    const { resume, leave } = resumedShare(lowering, at)
    return `${resume}\ntry {\n${body}\n} finally { ${leave} }`
}
