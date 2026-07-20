// ValidationErrorData — the built-in typed error for server-side input validation (rpc-core §9,
// §10). A failed input schema yields a 422 whose body narrows like any other typed error: it
// carries `kind: 'ValidationError'` plus `data` of this shape. `fields` is a flat map of the
// first message per top-level field path, convenient for form binding on the client.

import type { StandardSchemaV1 } from "./StandardSchema.ts";

export interface ValidationErrorData {
  issues: Array<{ message: string; path?: (string | number)[] }>;
  fields: Record<string, string>;
}

const VALIDATION_ERROR_KIND = "ValidationError";
const VALIDATION_ERROR_STATUS = 422;
const VALIDATION_ERROR_STATUS_TEXT = "Unprocessable Content";

// A single Standard Schema path segment can be a raw PropertyKey or a `{ key }` wrapper; unwrap to
// a plain string/number so `data.path` is a clean tuple.
function segmentKey(segment: PropertyKey | StandardSchemaV1.PathSegment): string | number {
  const key = typeof segment === "object" && segment !== null ? segment.key : segment;
  return typeof key === "number" ? key : String(key);
}

// Flatten Standard Schema issues into the serialisable ValidationErrorData shape.
export function toValidationErrorData(issues: ReadonlyArray<StandardSchemaV1.Issue>): ValidationErrorData {
  const flatIssues: ValidationErrorData["issues"] = [];
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const path = issue.path !== undefined ? issue.path.map(segmentKey) : undefined;
    flatIssues.push(path !== undefined ? { message: issue.message, path } : { message: issue.message });
    // The first segment names the top-level field; record only the first message seen for it.
    const field = path !== undefined && path.length > 0 ? String(path[0]) : "";
    if (fields[field] === undefined) fields[field] = issue.message;
  }
  return { issues: flatIssues, fields };
}

// Build the 422 Response carrying a ValidationErrorData payload, shaped like other typed errors so
// the client narrows it by `kind`.
export function validationError(issues: ReadonlyArray<StandardSchemaV1.Issue>): Response {
  const body = {
    status: VALIDATION_ERROR_STATUS,
    statusText: VALIDATION_ERROR_STATUS_TEXT,
    kind: VALIDATION_ERROR_KIND,
    data: toValidationErrorData(issues),
  };
  return new Response(JSON.stringify(body), {
    status: VALIDATION_ERROR_STATUS,
    headers: { "content-type": "application/json" },
  });
}
