// 56.1-56.12 — A FORM OVER A HANDLER, as parts an app spreads onto a `<form>` and fields of its own: the
// fields are read off the form as a post would carry them, checked against the document the build read
// for the handler's args (19.28) before the call is made, and the handler is called with what passes.
// What the check finds and what the server refuses are one shape — `Issues` of the handler (19.26) —
// so a field shows its message the same way whichever side found it.
//
// THE FIELDS ARE THE FORM'S OWN, read off it at a submit (`FormData`) rather than bound one by one: the
// names a field posts under are what it is checked by, and the same `<form>` posts to the handler with
// no script at all (16.38). A page holding a value per field still can; the form does not ask for one.

import { ARGS_DOCUMENT } from './ARGS_DOCUMENT.ts'
import { checkParts } from './checkParts.ts'
import { coerceArgs, collapsed, type Document } from './coerceArgs.ts'
import type { Issues } from './Issues.ts'
import { jsonSchema } from './jsonSchema.ts'
import type { JsonValue } from './JsonValue.ts'
import { randomToken } from './randomToken.ts'
import { reactive, watch } from './reactive/index.ts'
import type { Rpc } from './rpc.ts'
import { runSchema } from './Schema.ts'

// biome-ignore lint/suspicious/noExplicitAny: any handler at all, whatever it answers and refuses.
type AnyRpc = Rpc<any, any, any, any>

/** The names a form's fields post under: the members of the handler's args. */
export type FieldName<Handler> =
    Handler extends Rpc<
        infer _Value,
        infer Args,
        infer _Failures,
        infer _Produced
    >
        ? keyof NonNullable<Args> & string
        : string

/** One field's parts and what is wrong with it: `<input {...deal.field('title').input}>`. */
export type FormField = {
    /** The field's attributes: the name it posts under, whether it is invalid, and its message's id. */
    readonly input: Record<string, unknown>
    /** The attributes of the element showing the field's message, hidden while it has none. */
    readonly error: Record<string, unknown>
    /** The field's first message, or `undefined` where it has none. */
    readonly message: string | undefined
    /** Whether the field has a message. */
    readonly invalid: boolean
}

/** The parts `form` hands back, each spread onto an element: `<form {...deal.form}>`. */
export type Form<Handler extends AnyRpc> = {
    /** The `<form>`'s attributes and its submit. */
    readonly form: Record<string, unknown>
    /** A field's parts and its message, by the name it posts under. */
    field(name: FieldName<Handler>): FormField
    /** The attributes of the element showing the whole form's message, hidden while it has none. */
    readonly error: Record<string, unknown>
    /** The whole form's first message — one no field owns — or `undefined` where it has none. */
    readonly message: string | undefined
    /** A submit button's attributes: disabled while the call is in flight. */
    readonly submit: Record<string, unknown>
    /** What is wrong with the form: the check's findings, or else the last call's refusal. */
    readonly issues: Issues<Handler> | undefined
    /** The last call the form made, `busy` while it is in flight. */
    readonly call: ReturnType<Handler>
}

/** A form whose submit calls `handler` with its fields, checked first against its args' document. */
export function form<Handler extends AnyRpc>(handler: Handler): Form<Handler> {
    const document = (handler as unknown as Record<symbol, JsonValue>)[
        ARGS_DOCUMENT
    ]
    const schema = document === undefined ? undefined : jsonSchema(document)
    // 56.4 — the value a call is (4.19): written each submit, so `busy` and the refusal are the last one's.
    const call = reactive<Handler>() as unknown as ReturnType<Handler>
    // What the check last found, `null` where it found nothing; `undefined` where it has not run since
    // the last call was made, so the call's refusal is what shows.
    const checked = reactive<Record<string, string[]> | null | undefined>(
        undefined,
    )
    // Hydration runs setup again (41.6), and every attribute naming one is bound to it, so the ids are
    // rewritten together.
    const base = `form-${randomToken(4, 'hex')}`
    const errorId = (name: string) => `${base}-${encodeURIComponent(name)}`
    if (process.env.NODE_ENV !== 'production') checkParts('form', base)
    let shown: HTMLFormElement | undefined
    let focusing = false

    const issues = (): Record<string, string[]> | undefined => {
        const own = checked()
        if (own !== undefined) return own ?? undefined
        return call.issues() as Record<string, string[]> | undefined
    }
    const message = (name: string): string | undefined => issues()?.[name]?.[0]

    // 56.1 — the fields as a post carries them, coerced to the types the document declares (19.7).
    const argsOf = (element: HTMLFormElement): unknown => {
        const entries = new FormData(element)
        // 56.12 — a call carries JSON, which has no file in it.
        for (const [name, value] of entries)
            if (typeof value !== 'string')
                throw new Error(
                    `abide: the field '${name}' holds a file, which a form's call cannot carry. Send it with \`dropzone\` or a handler of its own. RULEBOOK 56.12.`,
                )
        return coerceArgs(
            collapsed(entries),
            document as Document | undefined,
            '',
        )
    }
    // 56.3 — a handler with no document is the server's to check.
    const check = (args: unknown): Record<string, string[]> | null =>
        schema === undefined
            ? null
            : (runSchema(schema, args).issues as Record<
                  string,
                  string[]
              > | null)

    // 56.6 — focus lands on the first field, in the form's own order, that has a message.
    const focusFirst = (found: Record<string, string[]>): void => {
        if (shown === undefined) return
        for (const field of shown.elements)
            if (
                field instanceof HTMLElement &&
                'name' in field &&
                typeof field.name === 'string' &&
                Object.hasOwn(found, field.name)
            ) {
                field.focus()
                return
            }
    }
    // 56.6 — and a refusal the server answers lands focus the same way, once the call settles.
    watch(() => {
        const refused = call.issues() as Record<string, string[]> | undefined
        if (!focusing || refused === undefined) return
        focusing = false
        focusFirst(refused)
    })

    const submitted = (event: SubmitEvent): void => {
        event.preventDefault()
        shown = event.currentTarget as HTMLFormElement
        // 56.5 — a submit while the last call is in flight is not a second call.
        if (call.busy()) return
        const args = argsOf(shown)
        const found = check(args)
        if (found !== null) {
            checked.set(found)
            focusFirst(found)
            return
        }
        checked.set(undefined)
        focusing = true
        ;(call as unknown as { set(value: unknown): void }).set(
            (handler as unknown as (args: unknown) => unknown)(args),
        )
    }
    // 56.7 — once something shows, an edit checks the form again, and what shows is what it finds.
    const edited = (event: Event): void => {
        if (issues() === undefined) return
        checked.set(check(argsOf(event.currentTarget as HTMLFormElement)))
    }

    // 56.8 — a POST is a form a browser can post without a script, to the handler's own address.
    const element: Record<string, unknown> =
        handler.method === 'POST'
            ? {
                  method: 'post',
                  action: handler.url(),
                  onsubmit: submitted,
                  oninput: edited,
                  'data-part': 'form',
              }
            : { onsubmit: submitted, oninput: edited, 'data-part': 'form' }
    // The element a message shows in: the whole form's under `''`, which no field posts under.
    const errorOf = (name: string): Record<string, unknown> => ({
        id: errorId(name),
        get hidden() {
            return message(name) === undefined
        },
        'data-part': 'error',
    })

    return {
        form: element,
        field: (name) => ({
            input: {
                name,
                get 'aria-invalid'() {
                    return message(name) === undefined ? undefined : 'true'
                },
                'aria-describedby': errorId(name),
                'data-part': 'input',
            },
            error: errorOf(name),
            get message() {
                return message(name)
            },
            get invalid() {
                return message(name) !== undefined
            },
        }),
        error: errorOf(''),
        get message() {
            return message('')
        },
        submit: {
            type: 'submit',
            get disabled() {
                return call.busy()
            },
            'data-part': 'submit',
        },
        get issues() {
            return issues() as Issues<Handler> | undefined
        },
        call,
    }
}
