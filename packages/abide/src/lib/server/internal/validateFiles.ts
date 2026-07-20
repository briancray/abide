// validateFiles — the multipart `files` schema check (TODO #8). A multipart mutation passes its
// parsed `FormData` here against the RPC's `schemas.files`; any failures come back as Standard
// Schema issues so the router funnels them through the same `validationError` (422) path as the
// JSON `input` schema. Minimal and JSON-Schema-ish: required file-field presence, plus optional
// per-field byte-size (`maxSize`) and MIME (`accept`) constraints. This validator speaks ONLY to the
// FILE fields — a `File` never rides in the JSON args object. The multipart TEXT fields are validated
// separately by the router against the JSON `input` schema (via `projectFormText`, TODO #8 follow-up).

import type { FilesSchema } from "./makeRpc.ts";
import type { StandardSchemaV1 } from "../../shared/StandardSchema.ts";

// Does a file's MIME type satisfy one `accept` token? Exact match or an `image/*`-style wildcard.
function mimeMatches(mimeType: string, accept: string): boolean {
  if (accept === "*/*" || accept === "*") return true;
  if (accept.endsWith("/*")) return mimeType.startsWith(accept.slice(0, -1));
  return mimeType === accept;
}

export function validateFiles(formData: FormData, schema: FilesSchema): StandardSchemaV1.Issue[] {
  const issues: StandardSchemaV1.Issue[] = [];

  const required = schema.required ?? [];
  for (const name of required) {
    const entry = formData.get(name);
    if (!(entry instanceof File)) {
      issues.push({ message: `Missing required file: ${name}`, path: [name] });
    }
  }

  const properties = schema.properties ?? {};
  for (const name of Object.keys(properties)) {
    const entry = formData.get(name);
    // Presence is the `required` list's job; an absent optional field is fine.
    if (!(entry instanceof File)) continue;
    const constraint = properties[name]!;
    if (constraint.maxSize !== undefined && entry.size > constraint.maxSize) {
      issues.push({ message: `File "${name}" is ${entry.size} bytes, exceeds max ${constraint.maxSize}`, path: [name] });
    }
    if (constraint.accept !== undefined) {
      const accepts = Array.isArray(constraint.accept) ? constraint.accept : [constraint.accept];
      if (!accepts.some((accept) => mimeMatches(entry.type, accept))) {
        issues.push({ message: `File "${name}" type "${entry.type}" is not accepted`, path: [name] });
      }
    }
  }

  return issues;
}
