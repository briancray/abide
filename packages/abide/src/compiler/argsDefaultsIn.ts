import type {
    CallExpression,
    Node,
    ObjectBindingPattern,
    ObjectLiteralExpression,
} from 'typescript/unstable/ast'
import {
    isArrowFunction,
    isCallExpression,
    isFunctionDeclaration,
    isFunctionExpression,
    isIdentifier,
    isObjectBindingPattern,
    isObjectLiteralExpression,
    isPropertyAssignment,
    isStringLiteral,
} from 'typescript/unstable/ast/is'
import { type Checker, SymbolFlags, type Type } from 'typescript/unstable/async'
import type { Finding } from './Finding.ts'
import { optionNamed, reactiveOptions } from './reactiveOptions.ts'

// 11.30 — AN `args` SCHEMA DEFAULTING A MEMBER THE BODY'S PARAMETER DOES NOT. The key is taken before
// `args` runs (11.26), so a default only the schema writes is applied after it: `{}` and `{ page: 1 }`
// are two entries the body runs the same for. A warning rather than a refusal: the program is valid,
// and the cost is work rather than a wrong value.
//
// WHAT THE SCHEMA DEFAULTS IS READ WITHOUT RUNNING IT: a `jsonSchema` document's `default` keyword
// where the document is written at the call, and otherwise a Standard Schema's own declared types —
// a member its input may leave out and its output always has is one it defaults. A schema that is a
// function says neither, and is not warned on.

/** The object pattern a function's first parameter destructures, or `undefined`. */
export function parameterPattern(
    node: Node | undefined,
): ObjectBindingPattern | undefined {
    if (
        node === undefined ||
        !(
            isArrowFunction(node) ||
            isFunctionExpression(node) ||
            isFunctionDeclaration(node)
        )
    )
        return undefined
    const pattern = node.parameters[0]?.name
    return pattern !== undefined && isObjectBindingPattern(pattern)
        ? pattern
        : undefined
}

/**
 * The args members a function's parameter pattern gives a default.
 *
 * 19.10 — THE ARGS MEMBERS A HANDLER DEFAULTS, which its annotation still calls required: the type
 * the `Rpc` carries is the one written, and a default lives on the pattern that destructures it.
 */
export function defaultedMembers(node: Node | undefined): string[] {
    const pattern = parameterPattern(node)
    if (pattern === undefined) return []
    const defaulted: string[] = []
    for (const element of pattern.elements) {
        if (element.initializer === undefined) continue
        const key = element.propertyName ?? element.name
        if (key !== undefined && (isIdentifier(key) || isStringLiteral(key)))
            defaulted.push(key.text)
    }
    return defaulted
}

/** Where a `reactive(…)`'s `args` defaults a member its body's parameter does not. */
export async function argsDefaultsIn(
    checker: Checker,
    sourceFile: Node,
): Promise<Finding[]> {
    const gated: { args: Node; body: Node }[] = []
    const visit = (node: Node): void => {
        if (isCallExpression(node)) {
            const args = argsOf(node)
            const body = node.arguments[0]
            if (args !== undefined && parameterPattern(body) !== undefined)
                gated.push({ args, body: body as Node })
        }
        node.forEachChild((child) => {
            visit(child)
            return undefined
        })
    }
    visit(sourceFile)
    const found: Finding[] = []
    for (const { args, body } of gated) {
        const written = defaultedMembers(body)
        for (const member of await schemaDefaults(checker, args))
            if (!written.includes(member))
                found.push({
                    at: args.getStart(),
                    message: `abide: \`args\` defaults \`${member}\`, and the body's parameter does not. The key is taken before \`args\` runs, so a call leaving \`${member}\` out and one writing its default are two entries the body runs the same for. Default \`${member}\` in the parameter too. RULEBOOK 11.30.`,
                })
    }
    return found
}

/** The `args` option a `reactive(…)` call writes, or `undefined`. */
function argsOf(call: CallExpression): Node | undefined {
    const options = reactiveOptions(call)
    return options === undefined ? undefined : optionNamed(options, 'args')
}

/** The members a schema defaults, as far as it can be read without running it. */
async function schemaDefaults(
    checker: Checker,
    schema: Node,
): Promise<string[]> {
    const document =
        isCallExpression(schema) &&
        isIdentifier(schema.expression) &&
        schema.expression.text === 'jsonSchema'
            ? schema.arguments[0]
            : undefined
    if (document !== undefined && isObjectLiteralExpression(document))
        return documentDefaults(document)
    const type = await checker.getTypeAtLocation(schema)
    return type === undefined ? [] : standardDefaults(checker, type)
}

/** The members a JSON Schema document written as a literal gives a `default`. */
function documentDefaults(document: ObjectLiteralExpression): string[] {
    const properties = optionNamed(document, 'properties')
    if (properties === undefined || !isObjectLiteralExpression(properties))
        return []
    const defaulted: string[] = []
    for (const property of properties.properties) {
        if (!isPropertyAssignment(property)) continue
        const key = property.name
        if (!(isIdentifier(key) || isStringLiteral(key))) continue
        const member = property.initializer
        if (
            isObjectLiteralExpression(member) &&
            optionNamed(member, 'default') !== undefined
        )
            defaulted.push(key.text)
    }
    return defaulted
}

/** The members a Standard Schema's input may leave out and its output always has. */
async function standardDefaults(
    checker: Checker,
    type: Type,
): Promise<string[]> {
    const standard = await memberType(checker, type, '~standard')
    const declared = standard && (await memberType(checker, standard, 'types'))
    const types = declared && (await checker.getNonNullableType(declared))
    const input = types && (await memberType(checker, types, 'input'))
    const output = types && (await memberType(checker, types, 'output'))
    if (!input || !output) return []
    const defaulted: string[] = []
    for (const member of await checker.getPropertiesOfType(output)) {
        if ((member.flags & SymbolFlags.Optional) !== 0) continue
        const given = await checker.getPropertyOfType(input, member.name)
        if (given === undefined || (given.flags & SymbolFlags.Optional) !== 0)
            defaulted.push(member.name)
    }
    return defaulted
}

async function memberType(
    checker: Checker,
    type: Type,
    name: string,
): Promise<Type | undefined> {
    const member = await checker.getPropertyOfType(type, name)
    return member === undefined ? undefined : checker.getTypeOfSymbol(member)
}
