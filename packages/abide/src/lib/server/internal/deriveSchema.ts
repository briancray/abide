// TS7 TYPE -> JSON-SCHEMA DERIVATION (M8b, rpc-core §11).
//
// Given a source file and the name of an exported RPC handler, resolve the handler's *function*
// (unwrapping helper wrappers like `GET((args) => ...)`), then map its single parameter type to an
// input JSON Schema and its return type (Promise-unwrapped) to an output JSON Schema. Unrepresentable
// types (functions, unbounded generics, symbols) do not fail — they emit a permissive `{}` and push a
// LOUD warning naming the type and field (loud-not-silent, §11.3).
//
// RUNTIME NOTE / API LIMITATION: this uses TypeScript 7's *sync* programmatic API
// (`typescript/unstable/sync`). That API spawns the `tsgo` engine and talks to it over a synchronous
// pipe using Node's internal `stdout._handle.fd`, which Bun does not expose — instantiating `API`
// under Bun throws `undefined is not an object (evaluating 'stdout._handle.fd')`. So when this module
// runs under Bun we shell out to `node` running THIS SAME FILE as a script (Node >= 23 strips the
// types), do the derivation in-process there, and read the JSON result back. Under Node the work
// happens directly in-process. Everything the checker exposes works fine — the only limitation is the
// transport, hence the subprocess bridge.

import { API, SignatureKind, SymbolFlags, TypeFlags } from "typescript/unstable/sync";
import type { Checker, Project, Signature, Symbol as TSSymbol, Type } from "typescript/unstable/sync";
import { isArrowFunction, isCallExpression, isFunctionDeclaration, isFunctionExpression, isVariableDeclaration } from "typescript/unstable/ast/is";
import type { Node } from "typescript/unstable/ast";
import type { JSONSchema } from "../../shared/internal/jsonSchema.ts";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type DeriveSchemaResult = { input?: JSONSchema; output?: JSONSchema; warnings: string[] };

// How deep to descend into nested object/array types before giving up. Recursive types are also
// guarded by an on-stack `seen` set of type ids; this bounds merely-deep (non-recursive) types.
const MAX_DEPTH = 24;

// Marker the subprocess prints so the Bun-side parent can find the JSON result line even if tsgo or
// something else writes to stdout.
const RESULT_MARKER = "__ABIDE_DERIVE_RESULT__:";

export function deriveSchema(filePath: string, exportName: string): DeriveSchemaResult {
  // Under Bun the sync TS API cannot open its pipe (see file header) — bridge through Node.
  const bun = (globalThis as { Bun?: unknown }).Bun;
  if (bun !== undefined) return deriveViaNodeSubprocess(filePath, exportName);
  return deriveInProcess(filePath, exportName);
}

function deriveViaNodeSubprocess(filePath: string, exportName: string): DeriveSchemaResult {
  const self = fileURLToPath(import.meta.url);
  const spawnSync = (globalThis as { Bun: { spawnSync: (cmd: string[], opts?: unknown) => { stdout: { toString(): string }; stderr: { toString(): string }; success: boolean } } }).Bun.spawnSync;
  const proc = spawnSync(["node", self, filePath, exportName], { stdout: "pipe", stderr: "pipe" });
  const stdout = proc.stdout.toString();
  const markerAt = stdout.lastIndexOf(RESULT_MARKER);
  if (markerAt === -1) {
    const stderr = proc.stderr.toString().trim();
    return { warnings: [`deriveSchema: Node subprocess produced no result${stderr ? ` (stderr: ${stderr})` : ""}`] };
  }
  const jsonStart = markerAt + RESULT_MARKER.length;
  const jsonEnd = stdout.indexOf("\n", jsonStart);
  const json = stdout.slice(jsonStart, jsonEnd === -1 ? undefined : jsonEnd);
  return JSON.parse(json) as DeriveSchemaResult;
}

function deriveInProcess(filePath: string, exportName: string): DeriveSchemaResult {
  const warnings: string[] = [];
  const result: DeriveSchemaResult = { warnings };
  const api = new API({ cwd: findProjectRoot(filePath) });
  try {
    const snapshot = api.updateSnapshot({ openFiles: [filePath] });
    const project = snapshot.getDefaultProjectForFile(filePath);
    if (project === undefined) {
      warnings.push(`deriveSchema: no TypeScript project found for ${filePath}`);
      return result;
    }
    const checker = project.checker;
    const sourceFile = project.program.getSourceFile(filePath);
    if (sourceFile === undefined) {
      warnings.push(`deriveSchema: source file ${filePath} is not part of the project`);
      return result;
    }
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
    if (moduleSymbol === undefined) {
      warnings.push(`deriveSchema: ${filePath} is not a module (no exports)`);
      return result;
    }
    const exported = checker.getExportsOfModule(moduleSymbol).find((symbol) => symbol.name === exportName);
    if (exported === undefined) {
      warnings.push(`deriveSchema: export "${exportName}" not found in ${filePath}`);
      return result;
    }
    const signature = findHandlerSignature(exported, checker, project);
    if (signature === undefined) {
      warnings.push(`deriveSchema: export "${exportName}" is not callable — cannot derive a schema`);
      return result;
    }

    const parameters = signature.getParameters();
    if (parameters.length > 0) {
      const inputType = checker.getTypeOfSymbol(parameters[0]!);
      if (inputType !== undefined) {
        result.input = typeToSchema(inputType, checker, warnings, new Set<number>(), 0, "");
      }
    }

    const returnType = checker.getReturnTypeOfSignature(signature);
    if (returnType !== undefined) {
      const resolved = unwrapPromise(returnType, checker);
      // void / undefined returns carry no output payload.
      if ((resolved.flags & (TypeFlags.Void | TypeFlags.Undefined)) === 0) {
        result.output = typeToSchema(resolved, checker, warnings, new Set<number>(), 0, "");
      }
    }
    return result;
  } finally {
    api.close();
  }
}

// The exported binding may be the function itself (`export const fn = (a) => ...`), a wrapped handler
// (`export const fn = GET((a) => ...)`), or a function declaration. Walk the value declaration to the
// innermost function-like node and take ITS call signature, so wrappers don't hide the real shape.
function findHandlerSignature(symbol: TSSymbol, checker: Checker, project: Project): Signature | undefined {
  const declaration = symbol.valueDeclaration?.resolve(project);
  if (declaration !== undefined) {
    const functionNode = findFunctionNode(declaration);
    if (functionNode !== undefined) {
      const signature = checker.getSignatureFromDeclaration(functionNode);
      if (signature !== undefined) return signature;
    }
  }
  // Fallback: read call signatures off the binding's type (covers exports whose value declaration we
  // could not resolve to a literal function).
  const type = checker.getTypeOfSymbol(symbol);
  if (type !== undefined) {
    const signatures = checker.getSignaturesOfType(type, SignatureKind.Call);
    if (signatures.length > 0) return signatures[0]!;
  }
  return undefined;
}

function findFunctionNode(node: Node): Node | undefined {
  if (isArrowFunction(node) || isFunctionExpression(node) || isFunctionDeclaration(node)) return node;
  if (isVariableDeclaration(node)) {
    return node.initializer === undefined ? undefined : findFunctionNode(node.initializer);
  }
  if (isCallExpression(node)) {
    for (const argument of node.arguments) {
      const found = findFunctionNode(argument);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

function unwrapPromise(type: Type, checker: Checker): Type {
  let current = type;
  // Unwrap nested Promise<...> (and Promise-like via symbol name) down to the settled value type.
  for (let i = 0; i < 8; i++) {
    if (current.getSymbol()?.name === "Promise" && current.isTypeReference()) {
      const args = checker.getTypeArguments(current);
      if (args.length > 0 && args[0] !== undefined) {
        current = args[0];
        continue;
      }
    }
    break;
  }
  return current;
}

function typeToSchema(type: Type, checker: Checker, warnings: string[], seen: Set<number>, depth: number, fieldPath: string): JSONSchema {
  const where = fieldPath === "" ? "<root>" : `"${fieldPath}"`;
  if (depth > MAX_DEPTH) {
    warnings.push(`deriveSchema: type at ${where} is nested too deeply (> ${MAX_DEPTH}); emitted permissive {}`);
    return {};
  }

  const flags = type.flags;

  // any / unknown are representable as "anything" — permissive, no warning.
  if ((flags & (TypeFlags.Any | TypeFlags.Unknown)) !== 0) return {};
  if ((flags & TypeFlags.Null) !== 0) return { type: "null" };
  // A bare undefined/void where a schema is required maps to permissive (unions filter these out).
  if ((flags & (TypeFlags.Undefined | TypeFlags.Void)) !== 0) return {};
  // never matches nothing.
  if ((flags & TypeFlags.Never) !== 0) return { not: {} };

  // Literals first — a literal also carries StringLike/NumberLike flags, so check before the generic
  // primitive branches.
  if (type.isStringLiteralType()) return { type: "string", const: type.value };
  if (type.isNumberLiteralType()) return { type: "number", const: type.value };
  if (type.isBooleanLiteralType()) return { type: "boolean", const: type.value };

  // `boolean` is internally a union of the `true`/`false` literals, so it must precede union handling.
  if ((flags & TypeFlags.Boolean) !== 0) return { type: "boolean" };
  if ((flags & TypeFlags.Number) !== 0) return { type: "number" };
  if ((flags & TypeFlags.String) !== 0) return { type: "string" };
  // JSON has no bigint; the closest representable shape is an integer.
  if ((flags & TypeFlags.BigInt) !== 0) return { type: "integer" };

  if ((flags & TypeFlags.ESSymbol) !== 0 || (flags & TypeFlags.UniqueESSymbol) !== 0) {
    warnings.push(`deriveSchema: symbol type at ${where} is not representable in JSON Schema; emitted permissive {}`);
    return {};
  }

  if (type.isUnionType()) {
    return unionToSchema(type, checker, warnings, seen, depth, fieldPath);
  }

  if (type.isObjectType()) {
    return objectToSchema(type, checker, warnings, seen, depth, fieldPath);
  }

  if (type.isTypeParameter()) {
    warnings.push(`deriveSchema: unbounded generic type parameter "${checker.typeToString(type)}" at ${where} is not representable; emitted permissive {}`);
    return {};
  }

  warnings.push(`deriveSchema: type "${checker.typeToString(type)}" at ${where} is not representable in JSON Schema; emitted permissive {}`);
  return {};
}

function unionToSchema(type: Type, checker: Checker, warnings: string[], seen: Set<number>, depth: number, fieldPath: string): JSONSchema {
  if (!type.isUnionType()) return {};
  // Drop undefined/void constituents — they encode optionality, handled by the containing object.
  const members = type.getTypes().filter((member) => (member.flags & (TypeFlags.Undefined | TypeFlags.Void)) === 0);

  if (members.length === 0) return {};
  if (members.length === 1) return typeToSchema(members[0]!, checker, warnings, seen, depth, fieldPath);

  // A union of pure literals collapses to an enum of their values.
  const allLiteral = members.every((member) => member.isLiteralType());
  if (allLiteral) {
    const values: unknown[] = [];
    for (const member of members) {
      if (member.isLiteralType()) values.push(member.value);
    }
    return { enum: values };
  }

  const anyOf: JSONSchema[] = [];
  for (const member of members) {
    anyOf.push(typeToSchema(member, checker, warnings, seen, depth + 1, fieldPath));
  }
  return { anyOf };
}

function objectToSchema(type: Type, checker: Checker, warnings: string[], seen: Set<number>, depth: number, fieldPath: string): JSONSchema {
  const where = fieldPath === "" ? "<root>" : `"${fieldPath}"`;

  // Date -> ISO date-time string.
  if (type.getSymbol()?.name === "Date") return { type: "string", format: "date-time" };

  // Array<T> -> { type: "array", items: schema(T) }.
  if (checker.isArrayType(type) && type.isTypeReference()) {
    const args = checker.getTypeArguments(type);
    const element = args[0];
    const items = element === undefined ? {} : typeToSchema(element, checker, warnings, seen, depth + 1, fieldPath === "" ? "[]" : `${fieldPath}[]`);
    return { type: "array", items };
  }

  // Tuple [A, B, ...] -> positional prefixItems with a fixed length. (The shared JSONSchema type's
  // `items` is a single schema, so tuples use `prefixItems`, which the runtime validator tolerates.)
  if (checker.isTupleType(type) && type.isTypeReference()) {
    const args = checker.getTypeArguments(type);
    const prefixItems: JSONSchema[] = [];
    for (let i = 0; i < args.length; i++) {
      prefixItems.push(typeToSchema(args[i]!, checker, warnings, seen, depth + 1, fieldPath === "" ? `[${i}]` : `${fieldPath}[${i}]`));
    }
    return { type: "array", prefixItems, minItems: args.length, maxItems: args.length };
  }

  const callSignatures = checker.getSignaturesOfType(type, SignatureKind.Call);
  const constructSignatures = checker.getSignaturesOfType(type, SignatureKind.Construct);
  const properties = checker.getPropertiesOfType(type);

  // A callable/constructable object with no data properties is a function/constructor — unrepresentable.
  if (properties.length === 0 && (callSignatures.length > 0 || constructSignatures.length > 0)) {
    const kind = callSignatures.length > 0 ? "function" : "constructor";
    warnings.push(`deriveSchema: ${kind} type "${checker.typeToString(type)}" at ${where} is not representable in JSON Schema; emitted permissive {}`);
    return {};
  }

  // Break cycles on recursive/self-referential object types.
  if (seen.has(type.id)) return {};
  seen.add(type.id);

  const schemaProperties: Record<string, JSONSchema> = {};
  const required: string[] = [];
  for (const property of properties) {
    const propertyType = checker.getTypeOfSymbol(property);
    const childPath = fieldPath === "" ? property.name : `${fieldPath}.${property.name}`;
    if (propertyType === undefined) {
      warnings.push(`deriveSchema: could not resolve the type of property "${childPath}"; emitted permissive {}`);
      schemaProperties[property.name] = {};
    } else {
      schemaProperties[property.name] = typeToSchema(propertyType, checker, warnings, seen, depth + 1, childPath);
    }
    if ((property.flags & SymbolFlags.Optional) === 0) required.push(property.name);
  }

  seen.delete(type.id);

  const schema: JSONSchema = { type: "object", properties: schemaProperties };
  if (required.length > 0) schema.required = required;
  return schema;
}

function findProjectRoot(filePath: string): string {
  let directory = dirname(filePath);
  for (let i = 0; i < 64; i++) {
    if (existsSync(join(directory, "tsconfig.json"))) return directory;
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return process.cwd();
}

// When executed directly by Node (the Bun-side bridge above), read args and print the JSON result.
if (import.meta.main) {
  const filePath = process.argv[2];
  const exportName = process.argv[3];
  if (filePath === undefined || exportName === undefined) {
    process.stderr.write("usage: node deriveSchema.ts <filePath> <exportName>\n");
    process.exit(2);
  }
  const derived = deriveInProcess(filePath, exportName);
  process.stdout.write(`${RESULT_MARKER}${JSON.stringify(derived)}\n`);
}
