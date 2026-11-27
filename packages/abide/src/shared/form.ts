// 56.1-56.23 — A FORM OVER A HANDLER, as parts an app spreads onto a `<form>` and fields of its own: the
// fields are read off the form as a post would carry them, checked against the document the build read
// for the handler's args (19.28) before the call is made, and the handler is called with what passes.
// What the check finds and what the server refuses are one shape — `Issues` of the handler (19.26) —
// so a field shows its message the same way whichever side found it.
//
// THE FIELDS ARE THE FORM'S OWN, read off it at a submit (`FormData`) rather than bound one by one: the
// names a field posts under are what it is checked by, and the same `<form>` posts to the handler with
// no script at all (16.38). A page holding a value per field still can; the form does not ask for one.
//
// THE BASELINE IS THE DOM'S OWN (56.14): what a field's reset restores — its `value` attribute, its
// `checked`, its options' `selected` — so the page renders it with the field, a reset button needs no
// script, and a save moves it by writing those defaults rather than by keeping a copy beside them.

import { ARGS_DOCUMENT } from './ARGS_DOCUMENT.ts'
import { checkParts } from './checkParts.ts'
import { coerceArgs, collapsed, type Document } from './coerceArgs.ts'
import type { Issues } from './Issues.ts'
import { jsonSchema } from './jsonSchema.ts'
import type { JsonValue } from './JsonValue.ts'
import { madeId } from './madeId.ts'
import {
    type CallOf,
    type Reactive,
    reactive,
    watch,
} from './reactive/index.ts'
import { untracked } from './reactive/tracking.ts'
import type { ReadRpc } from './rpc.ts'
import { runSchema } from './Schema.ts'

// biome-ignore lint/suspicious/noExplicitAny: any handler at all, whatever it answers and refuses.
type AnyRpc = ReadRpc<any, any, any, any>

/** The names a form's fields post under: the members of the handler's args. */
export type FieldName<Handler> =
    Handler extends ReadRpc<
        infer _Value,
        infer Args,
        infer _Failures,
        infer _Produced
    >
        ? keyof NonNullable<Args> & string
        : string

/** One field's parts and what is wrong with it: `<input {...deal.field('title').input}>`. */
export type FormField = {
    /** The field's attributes: the name it posts under, whether it is invalid, and its message's id while it has one. */
    readonly input: Record<string, unknown>
    /** The attributes of the element showing the field's message, hidden while it has none. */
    readonly error: Record<string, unknown>
    /** The field's first message, or `undefined` where it has none. */
    get message(): string | undefined
    /** Whether the field has a message. */
    get invalid(): boolean
    /** Whether a field posting under the name differs from its baseline. */
    get changed(): boolean
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
    get message(): string | undefined
    /** A submit button's attributes: disabled while the call is in flight. */
    readonly submit: Record<string, unknown>
    /** A reset button's attributes: disabled while no field differs from its baseline. */
    readonly reset: Record<string, unknown>
    /** Whether any field differs from its baseline. */
    get dirty(): boolean
    /** The args a submit would send, holding only the fields that differ from their baseline. */
    get changes(): Handler extends ReadRpc<
        infer _Value,
        infer Args,
        infer _Failures,
        infer _Produced
    >
        ? Partial<NonNullable<Args>>
        : Record<string, unknown>
    /** What is wrong with the form: the check's findings, or else the last call's refusal. */
    get issues(): Issues<Handler> | undefined
    /** The last call the form made, `busy` while it is in flight. */
    readonly call: CallOf<Handler>
}

/** What a `form` does once a call it made answers without a failure. */
export type FormOptions<Handler extends AnyRpc> = {
    /** 56.34 — whether the `<form>` starts over, each field back to how it rendered, rather than keeping what it sent. `false` by default. */
    resetOnSuccess?: boolean | undefined
    /** 56.35 — called with what the call answered, once the fields have moved. */
    onsuccess?:
        | ((
              value: Handler extends ReadRpc<
                  infer Value,
                  infer _Args,
                  infer _Failures,
                  infer _Produced
              >
                  ? Value
                  : unknown,
          ) => void)
        | undefined
}

/** A form whose submit calls `handler` with its fields, checked first against its args' document. */
export function form<Handler extends AnyRpc>(
    handler: Handler,
    options: FormOptions<Handler> = {},
): Form<Handler> {
    const document = (handler as unknown as Record<symbol, JsonValue>)[
        ARGS_DOCUMENT
    ]
    const schema = document === undefined ? undefined : jsonSchema(document)
    // 56.4 — the value a call is (4.19): written each submit, so `busy` and the refusal are the last one's.
    const call = reactive<Handler>() as unknown as CallOf<Handler>
    // What the check last found, `null` where it found nothing; `undefined` where it has not run since
    // the last call was made, so the call's refusal is what shows.
    const checked = reactive<Record<string, string[]> | null | undefined>(
        undefined,
    )
    // Hydration runs setup again (41.6), and every attribute naming one is bound to it, so the ids are
    // rewritten together.
    const base = madeId('form')
    const errorId = (name: string) => `${base}-${encodeURIComponent(name)}`
    if (process.env.NODE_ENV !== 'production') checkParts('form', base)
    let shown: HTMLFormElement | undefined
    let focusing = false

    // 56.16, 56.23 — the names whose fields differ from their baseline, and a cell per name a part has
    // read, so an edit wakes only the readers of a name whose answer it moved.
    const differing = new Set<string>()
    const changedCells = new Map<string, Reactive<boolean>>()
    const dirty = reactive(false)
    // `changes` reads the fields themselves, and this is the version it subscribes to.
    const edits = reactive(0)
    const changed = (name: string): boolean => {
        let cell = changedCells.get(name)
        if (cell === undefined) {
            cell = reactive(differing.has(name))
            changedCells.set(name, cell)
        }
        return cell()
    }
    const published = (): void => {
        for (const [name, cell] of changedCells) cell.set(differing.has(name))
        dirty.set(differing.size > 0)
        edits.set((edits.peek() ?? 0) + 1)
    }
    const measure = (element: HTMLFormElement): void => {
        differing.clear()
        for (const field of element.elements)
            if (isField(field) && differs(field)) differing.add(field.name)
        published()
    }
    // 56.19 — what each field held when the last call was made, its baseline once that call answers.
    let sent: [FieldElement, Held][] | undefined
    const sends = reactive(0)

    const issues = (): Record<string, string[]> | undefined => {
        const own = checked()
        if (own !== undefined) return own ?? undefined
        return call.issues() as Record<string, string[]> | undefined
    }
    // 56.13 — the whole form's message is also a failure that names no field: a 401, a 409.
    const message = (name: string): string | undefined => {
        const found = issues()
        const own = found?.[name]?.[0]
        if (own !== undefined) return own
        if (name === '')
            return found !== undefined ? undefined : call.error()?.message
        // 56.36 — a field posting a structured member (19.27) owns every issue beneath its name.
        if (found !== undefined) {
            const beneath = `${name}.`
            for (const path in found)
                if (path.startsWith(beneath)) return found[path]?.[0]
        }
        return undefined
    }

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
    // 56.19 — a call answered without a failure moves the baseline to what it sent, or, 56.34, starts
    // the form over; and 56.35 hands what it answered on once the fields have moved.
    watch(() => {
        sends()
        if (call.busy() || sent === undefined) return
        const kept = sent
        sent = undefined
        if (call.error() !== undefined || shown === undefined) return
        if (options.resetOnSuccess === true) shown.reset()
        else {
            for (const [field, value] of kept) adopt(field, value)
            measure(shown)
        }
        // Untracked, so what the app's callback reads is not this watch's to rerun on.
        const onsuccess = options.onsuccess
        if (onsuccess !== undefined)
            untracked(onsuccess, call.peek() as never, undefined)
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
        const holding: [FieldElement, Held][] = []
        for (const field of shown.elements)
            if (isField(field)) holding.push([field, held(field)])
        sent = holding
        ;(call as unknown as { set(value: unknown): void }).set(
            (handler as unknown as (args: unknown) => unknown)(args),
        )
        sends.set((sends.peek() ?? 0) + 1)
    }
    const edited = (event: Event): void => {
        shown = event.currentTarget as HTMLFormElement
        measure(shown)
        // 56.7 — once something shows, an edit checks the form again, and what shows is what it finds.
        if (issues() === undefined) return
        checked.set(check(argsOf(shown)))
    }
    // 56.18 — the reset event comes before the reset it announces, so nothing is read: a reset leaves
    // every field at its baseline, unless a listener called it off.
    const resetting = (event: Event): void => {
        if (event.defaultPrevented) return
        shown = event.currentTarget as HTMLFormElement
        differing.clear()
        published()
    }

    // 56.8 — a POST is a form a browser can post without a script, to the handler's own address.
    const element: Record<string, unknown> = {
        ...(handler.method === 'POST'
            ? { method: 'post', action: handler.url() }
            : {}),
        onsubmit: submitted,
        oninput: edited,
        onreset: resetting,
        // 56.20
        get 'data-dirty'() {
            return dirty() ? '' : undefined
        },
        'data-form': 'form',
    }
    // The element a message shows in: the whole form's under `''`, which no field posts under.
    const errorOf = (name: string): Record<string, unknown> => ({
        id: errorId(name),
        get hidden() {
            return message(name) === undefined
        },
        'data-form': 'error',
    })

    return {
        form: element,
        field: (name) => ({
            input: {
                name,
                get 'aria-invalid'() {
                    return message(name) === undefined ? undefined : 'true'
                },
                // 56.9 — only while there is a message to name: a field whose error is never
                // rendered, a hidden input's, names no element the document does not hold (49.7).
                get 'aria-describedby'() {
                    return message(name) === undefined
                        ? undefined
                        : errorId(name)
                },
                // 56.21
                get 'data-changed'() {
                    return changed(name) ? '' : undefined
                },
                'data-form': 'input',
            },
            error: errorOf(name),
            get message() {
                return message(name)
            },
            get invalid() {
                return message(name) !== undefined
            },
            get changed() {
                return changed(name)
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
            'data-form': 'submit',
        },
        // 56.22
        reset: {
            type: 'reset',
            get disabled() {
                return !dirty()
            },
            'data-form': 'reset',
        },
        get dirty() {
            return dirty()
        },
        // 56.17 — the args 56.1 reads, narrowed to the names that differ.
        get changes() {
            edits()
            const narrowed: Record<string, unknown> = {}
            if (shown !== undefined && differing.size > 0) {
                const args = argsOf(shown) as Record<string, unknown>
                for (const name of differing)
                    if (Object.hasOwn(args, name)) narrowed[name] = args[name]
            }
            return narrowed as never
        },
        get issues() {
            return issues() as Issues<Handler> | undefined
        },
        call,
    }
}

type FieldElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
// What a field holds that its baseline is written from: its checkedness, each option's selectedness,
// or its text.
type Held = boolean | boolean[] | string

/** Whether `element` is a named field whose value a post carries. */
function isField(element: Element): element is FieldElement {
    return (
        (element instanceof HTMLInputElement ||
            element instanceof HTMLTextAreaElement ||
            element instanceof HTMLSelectElement) &&
        element.name !== ''
    )
}

function isCheckable(field: FieldElement): field is HTMLInputElement {
    return field.type === 'checkbox' || field.type === 'radio'
}

// 56.14, 56.15 — a field against its baseline: its text against its `value` attribute, blank where it
// has none; its checkedness against `checked`; the option chosen against the one a reset chooses.
function differs(field: FieldElement): boolean {
    if (isCheckable(field)) return field.checked !== field.defaultChecked
    if (!(field instanceof HTMLSelectElement))
        return field.value !== field.defaultValue
    if (!field.multiple) return field.selectedIndex !== resetIndex(field)
    for (const option of field.options)
        if (option.selected !== option.defaultSelected) return true
    return false
}

/** The option a single `<select>`'s reset chooses: the last marked `selected`, or its first enabled one. */
function resetIndex(select: HTMLSelectElement): number {
    let marked = -1
    let firstEnabled = -1
    for (let index = 0; index < select.options.length; index++) {
        const option = select.options[index] as HTMLOptionElement
        if (option.defaultSelected) marked = index
        if (firstEnabled === -1 && !option.disabled) firstEnabled = index
    }
    return marked === -1 ? firstEnabled : marked
}

function held(field: FieldElement): Held {
    if (isCheckable(field)) return field.checked
    if (!(field instanceof HTMLSelectElement)) return field.value
    const selected: boolean[] = []
    for (const option of field.options) selected.push(option.selected)
    return selected
}

/** Makes what `field` held its baseline. */
function adopt(field: FieldElement, value: Held): void {
    if (isCheckable(field)) field.defaultChecked = value as boolean
    else if (field instanceof HTMLSelectElement) {
        const selected = value as boolean[]
        for (let index = 0; index < field.options.length; index++)
            (field.options[index] as HTMLOptionElement).defaultSelected =
                selected[index] === true
    } else field.defaultValue = value as string
}
