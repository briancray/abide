import type { StandardSchemaV1 } from '../../shared/types/StandardSchemaV1.ts'

/*
Flattens Standard Schema issues into a top-level-field → first-message map, the
form-friendly companion to the raw `issues` on a 422. A path segment is either a
bare `PropertyKey` or a `{ key }` wrapper (the spec allows both), so normalize
before reading. First message wins per field (a form shows one per input); the
raw `issues` keep every message and the full path. Issues with no string field
(root-level refinements) are omitted — they live only in `issues`.
*/
export function fieldErrorsFromIssues(
    issues: readonly StandardSchemaV1.Issue[],
): Record<string, string> {
    const fields: Record<string, string> = {}
    for (const issue of issues) {
        const segment = issue.path?.[0]
        const key = typeof segment === 'object' ? segment.key : segment
        if (typeof key === 'string' && !(key in fields)) {
            fields[key] = issue.message
        }
    }
    return fields
}
