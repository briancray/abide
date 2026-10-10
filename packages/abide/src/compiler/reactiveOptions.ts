import type {
    CallExpression,
    Node,
    ObjectLiteralExpression,
} from 'typescript/unstable/ast'
import {
    isArrowFunction,
    isCallExpression,
    isFunctionExpression,
    isIdentifier,
    isObjectLiteralExpression,
    isPropertyAssignment,
} from 'typescript/unstable/ast/is'
import type { Method } from '#shared/rpc.ts'

/**
 * The options object literal a value is built with — `reactive(x, { … })`, or `GET(f, { … })` over
 * a function written in place (16.6) — or `undefined`.
 *
 * The WRITTEN object is what the build can read without running it (20.4). `undefined` where
 * `call` is neither, or where its options are built elsewhere.
 */
export function reactiveOptions(
    call: Node | undefined,
): ObjectLiteralExpression | undefined {
    if (
        call === undefined ||
        !isCallExpression(call) ||
        !(isReactiveCall(call) || isDeclaredOverBody(call))
    )
        return undefined
    const options = call.arguments[1]
    return options !== undefined && isObjectLiteralExpression(options)
        ? options
        : undefined
}

/** Whether a call is `reactive(…)`, by the callee's spelling. */
export function isReactiveCall(call: Node & { expression: Node }): boolean {
    return isIdentifier(call.expression) && call.expression.text === 'reactive'
}

/** The five handler declarers, by the spelling `isReactiveCall` reads `reactive` by. */
export const METHODS: ReadonlySet<string> = new Set<Method>([
    'GET',
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
])

/** Whether a call is a declarer handed a function written in place, which it builds a value of. */
function isDeclaredOverBody(call: CallExpression): boolean {
    return (
        isIdentifier(call.expression) &&
        METHODS.has(call.expression.text) &&
        isWrittenInPlace(call.arguments[0])
    )
}

/** Whether a body is a function written in place, rather than one named. */
export function isWrittenInPlace(body: Node | undefined): boolean {
    return (
        body !== undefined &&
        (isArrowFunction(body) || isFunctionExpression(body))
    )
}

/** The initializer `options` writes for `name`, or `undefined` where it writes none. */
export function optionNamed(
    options: ObjectLiteralExpression,
    name: string,
): Node | undefined {
    for (const property of options.properties)
        if (
            isPropertyAssignment(property) &&
            isIdentifier(property.name) &&
            property.name.text === name
        )
            return property.initializer
    return undefined
}
