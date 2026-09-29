import type { Node, ObjectLiteralExpression } from 'typescript/unstable/ast'
import {
    isCallExpression,
    isIdentifier,
    isObjectLiteralExpression,
    isPropertyAssignment,
} from 'typescript/unstable/ast/is'

/**
 * The options object literal written at a `reactive(x, { … })` call, or `undefined`.
 *
 * The WRITTEN object is what the build can read without running it (20.4). `undefined` where
 * `call` is not one, or where its options are built elsewhere.
 */
export function reactiveOptions(
    call: Node | undefined,
): ObjectLiteralExpression | undefined {
    if (call === undefined || !isCallExpression(call) || !isReactiveCall(call))
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
