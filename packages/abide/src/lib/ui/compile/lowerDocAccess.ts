import ts from 'typescript'
import { escapeKey } from '../runtime/escapeKey.ts'

/*
The linchpin compiler pass. Rewrites idiomatic data access on a reactive document
binding into the document's patch/read API, so an author writes plain property
syntax and the runtime gets addressed change — the thing that makes a real
component hit the fast path instead of building path strings by hand:

  model.note = 'x'        →  model.replace("note", 'x')
  model.count += 1        →  model.replace("count", model.read("count") + 1)
  model.lines.push(v)     →  model.add("lines/-", v)
  delete model.byId[key]  →  model.remove("byId/" + escapeKey(key))
  model.lines[0].sku      →  model.read("lines/0/sku")
  model.lines[i].sku      →  model.read("lines/" + escapeKey(i) + "/sku")

A member/element-access chain rooted at `docName` becomes a `/`-joined path:
literal keys and numeric indices fold into one string literal; a non-literal
index makes the path a template (a dynamic segment). Path segments are
JSON-Pointer-escaped so a key holding `/` or `~` addresses one segment, not
many — literal keys at compile time, dynamic ones wrapped in a runtime
`escapeKey(...)`. Reads are lowered to `read(path)`; a later pass hoists
static-path reads to a `cell` bound once at component init (the string-free hot
path the bench measured). Index expressions are themselves visited, so a read
used as an index lowers too.
*/
export function lowerDocAccess(code: string, docName: string): string {
    const source = ts.createSourceFile('component.ts', code, ts.ScriptTarget.Latest, true)
    const result = ts.transform(source, [docAccessTransformer(docName)])
    const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed })
    const output = printer.printFile(result.transformed[0] as ts.SourceFile)
    result.dispose()
    return output
}

/* A path segment is either a literal key or a runtime expression (a dynamic index). */
type Segment = { kind: 'literal'; value: string } | { kind: 'expression'; node: ts.Expression }

/* Maps a compound-assignment operator to its plain binary counterpart. Logical
   assignments (`||=`/`&&=`/`??=`) lower to an unconditional replace of the
   combined value — consistent with how `+=` lowers (the patch always writes). */
const COMPOUND_OPERATORS = new Map<ts.SyntaxKind, ts.BinaryOperator>([
    [ts.SyntaxKind.PlusEqualsToken, ts.SyntaxKind.PlusToken],
    [ts.SyntaxKind.MinusEqualsToken, ts.SyntaxKind.MinusToken],
    [ts.SyntaxKind.AsteriskEqualsToken, ts.SyntaxKind.AsteriskToken],
    [ts.SyntaxKind.SlashEqualsToken, ts.SyntaxKind.SlashToken],
    [ts.SyntaxKind.BarBarEqualsToken, ts.SyntaxKind.BarBarToken],
    [ts.SyntaxKind.AmpersandAmpersandEqualsToken, ts.SyntaxKind.AmpersandAmpersandToken],
    [ts.SyntaxKind.QuestionQuestionEqualsToken, ts.SyntaxKind.QuestionQuestionToken],
])

export function docAccessTransformer(docName: string): ts.TransformerFactory<ts.SourceFile> {
    return (context) => (root) => {
        /* Collects the path of an access chain rooted at `docName`, visiting any
           dynamic index so reads inside it lower too. undefined if not our doc. */
        function pathSegments(node: ts.Expression): Segment[] | undefined {
            const segments: Segment[] = []
            let current: ts.Expression = node
            while (true) {
                if (ts.isPropertyAccessExpression(current)) {
                    /* A property name is an identifier — escapeKey is a no-op on it, but
                       a string-literal element key (`model["a/b"]`) can carry `/`|`~` and
                       must escape at compile time so the `/`-joined path doesn't mis-split. */
                    segments.unshift({ kind: 'literal', value: escapeKey(current.name.text) })
                    current = current.expression
                } else if (ts.isElementAccessExpression(current)) {
                    const argument = current.argumentExpression
                    if (ts.isStringLiteral(argument) || ts.isNumericLiteral(argument)) {
                        segments.unshift({ kind: 'literal', value: escapeKey(argument.text) })
                    } else {
                        segments.unshift({
                            kind: 'expression',
                            node: ts.visitNode(argument, visit) as ts.Expression,
                        })
                    }
                    current = current.expression
                } else {
                    break
                }
            }
            if (ts.isIdentifier(current) && current.text === docName && segments.length > 0) {
                return segments
            }
            return undefined
        }

        function visit(node: ts.Node): ts.Node {
            /* Assignment (plain or compound) to a doc path → replace patch. */
            if (ts.isBinaryExpression(node)) {
                const segments = pathSegments(node.left as ts.Expression)
                if (segments) {
                    const operator = node.operatorToken.kind
                    if (operator === ts.SyntaxKind.EqualsToken) {
                        return docCall(docName, 'replace', [
                            buildPath(segments),
                            ts.visitNode(node.right, visit) as ts.Expression,
                        ])
                    }
                    const binary = COMPOUND_OPERATORS.get(operator)
                    if (binary) {
                        const next = ts.factory.createBinaryExpression(
                            docCall(docName, 'read', [buildPath(segments)]),
                            binary,
                            ts.visitNode(node.right, visit) as ts.Expression,
                        )
                        return docCall(docName, 'replace', [buildPath(segments), next])
                    }
                }
            }
            /* doc array `.push(a, b, …)` → one `add` patch per argument at the array's `-`
               slot, matching native multi-arg push (each lands at the end in order). */
            if (
                ts.isCallExpression(node) &&
                ts.isPropertyAccessExpression(node.expression) &&
                node.expression.name.text === 'push'
            ) {
                const segments = pathSegments(node.expression.expression)
                if (segments && node.arguments.length > 0) {
                    const adds = node.arguments.map(
                        (pushed) =>
                            docCall(docName, 'add', [
                                buildPath([...segments, { kind: 'literal', value: '-' }]),
                                ts.visitNode(pushed, visit) as ts.Expression,
                            ]) as ts.Expression,
                    )
                    /* `node.arguments.length > 0` above guarantees `adds` is non-empty, so the
                       single-element branch's `adds[0]` is defined. */
                    return adds.length === 1 ? adds[0]! : ts.factory.createCommaListExpression(adds)
                }
            }
            /* A called member on a doc chain is a method on the read value, not a
               deeper path: `model.draft.trim()` → `readCall(model.read("draft"), …)`,
               `model.items.map(f)` → `readCall(model.read("items"), …)`. (Array `.push`
               above is the exception — it lowers to an `add` patch.) */
            if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
                const access = node.expression
                const segments = pathSegments(access.expression)
                if (segments) {
                    const read = docCall(docName, 'read', [buildPath(segments)])
                    const args = node.arguments.map(
                        (arg) => ts.visitNode(arg, visit) as ts.Expression,
                    )
                    /* Optional chaining is the author's explicit skip-if-absent: a nullish
                       read short-circuits the whole call to `undefined`. Keep it bare —
                       routing it through the throwing guard would invert that semantics.
                       The call continues the chain whenever the access OR the call carries a
                       `?.`, so `model.x?.m()` short-circuits the call too. */
                    if (access.questionDotToken || node.questionDotToken) {
                        const member = access.questionDotToken
                            ? ts.factory.createPropertyAccessChain(
                                  read,
                                  access.questionDotToken,
                                  access.name,
                              )
                            : ts.factory.createPropertyAccessExpression(read, access.name.text)
                        return ts.factory.createCallChain(
                            member,
                            node.questionDotToken,
                            node.typeArguments,
                            args,
                        )
                    }
                    /* A non-optional call on an absent read throws the engine's opaque
                       `undefined is not an object`. Route it through `readCall`, which throws
                       naming the authored scope path and member — the key and member are both
                       in hand here, the `.abide` location comes free off the mapped stack. */
                    return ts.factory.createCallExpression(
                        ts.factory.createIdentifier('readCall'),
                        undefined,
                        [
                            read,
                            buildPath(segments),
                            ts.factory.createStringLiteral(access.name.text),
                            ts.factory.createArrayLiteralExpression(args),
                        ],
                    )
                }
            }
            /* delete doc.path → remove patch. */
            if (ts.isDeleteExpression(node)) {
                const segments = pathSegments(node.expression)
                if (segments) {
                    return docCall(docName, 'remove', [buildPath(segments)])
                }
            }
            /* Any remaining doc access chain is a read. */
            if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
                const segments = pathSegments(node)
                if (segments) {
                    return docCall(docName, 'read', [buildPath(segments)])
                }
            }
            return ts.visitEachChild(node, visit, context)
        }

        return ts.visitNode(root, visit) as ts.SourceFile
    }
}

/* Builds `docName.method(...args)`. */
function docCall(docName: string, method: string, args: ts.Expression[]): ts.CallExpression {
    return ts.factory.createCallExpression(
        ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier(docName), method),
        undefined,
        args,
    )
}

/*
Turns segments into a path expression: an all-literal path is one string literal
(`"lines/0/sku"`); a path with a dynamic segment is a string-concatenation that
evaluates to the path at runtime (`"lines/" + escapeKey(i) + "/sku"`), kept
string-typed by leading with a literal.
*/
function buildPath(segments: Segment[]): ts.Expression {
    if (segments.every((segment) => segment.kind === 'literal')) {
        return ts.factory.createStringLiteral(
            segments.map((segment) => (segment as { value: string }).value).join('/'),
        )
    }
    const fragments: ts.Expression[] = []
    /* Append text to the trailing string fragment when there is one, so a `/`
       separator folds into the preceding literal (`"lines/" + i`) rather than
       printing as its own term (`"lines" + "/" + i`). */
    const appendText = (text: string): void => {
        const last = fragments[fragments.length - 1]
        if (last !== undefined && ts.isStringLiteral(last)) {
            fragments[fragments.length - 1] = ts.factory.createStringLiteral(last.text + text)
        } else {
            fragments.push(ts.factory.createStringLiteral(text))
        }
    }
    segments.forEach((segment, index) => {
        const separator = index === 0 ? '' : '/'
        if (segment.kind === 'literal') {
            appendText(separator + segment.value)
        } else {
            if (separator !== '') {
                appendText(separator)
            }
            /* A dynamic key's value is unknown at compile time — escape it at runtime so a
               key holding `/`|`~` (a date, a composite id) addresses one segment, not many. */
            fragments.push(
                ts.factory.createCallExpression(
                    ts.factory.createIdentifier('escapeKey'),
                    undefined,
                    [segment.node],
                ),
            )
        }
    })
    const head = fragments[0]
    if (head === undefined || !ts.isStringLiteral(head)) {
        fragments.unshift(ts.factory.createStringLiteral(''))
    }
    return fragments.reduce((left, right) =>
        ts.factory.createBinaryExpression(left, ts.SyntaxKind.PlusToken, right),
    )
}
