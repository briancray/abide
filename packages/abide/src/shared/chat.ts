// 53.31-53.40 — A CONVERSATION OVER AN ASSISTANT HANDLER, as parts: the transcript as it streams, and
// a composer that sends on Enter. 53.32 — every event is folded into the answering turn once, through
// `patch`, so a chunk rewrites the part it lands in and nothing before it. The markup — how a turn,
// a tool call or a permission reads — is the app's; what a conversation DOES is here.

import type { AssistantEvent, AssistantMessage } from './AssistantEvent.ts'
import type { AssistantTurn, AssistantTurnPart } from './AssistantTurn.ts'
import { dropzone } from './dropzone.ts'
import { autoscroll } from './autoscroll.ts'
import { hotkeys } from './hotkeys.ts'
import { imageFiles, imagePiece } from './imagePiece.ts'
import { type Live, live } from './live.ts'
import { messageOf } from './messageOf.ts'
import { reactive } from './reactive/index.ts'
import type { Reactive } from './reactive/Reactive.ts'
import { fold } from './transcript/fold.ts'
import { messages } from './transcript/messages.ts'
import { turn as turnOf } from './transcript/turn.ts'
import { withPart } from './withPart.ts'

type Image = Extract<AssistantTurnPart, { type: 'image' }>
type ToolPart = Extract<AssistantTurnPart, { type: 'tool' }>
type Permission = Extract<AssistantTurnPart, { type: 'permission' }>

export type ChatOptions = {
    /**
     * The app's assistant handler, a `POST` yielding `assistant`'s events, called with the
     * conversation so far and a `signal` that `stop` aborts.
     */
    ask: (
        args: { messages: AssistantMessage[] },
        options: { signal: AbortSignal },
    ) => AsyncIterable<AssistantEvent>
    /**
     * Answers a `permission` prompt: the app's handler calling `provider.claudeCode.permit`. Without
     * it a prompt's buttons are disabled.
     */
    permit?: ((answer: { id: string; allow: boolean }) => unknown) | undefined
    /** 49.8, 53.47 — the conversation: bind it to load one and to keep it as it grows. Held by the parts, empty, where none is given. */
    turns?: Reactive<AssistantTurn[]>
    /** The input's accessible name. `'Message'` by default. */
    label?: Live<string | undefined>
    /** Whether the composer refuses to send: a provider not yet paired, say. */
    disabled?: Live<boolean | undefined>
}

/** A turn's parts: the turn's element, its speaker, and what is shown under it once it has ended. */
export type ChatTurnParts = {
    /** The turn's element: `data-speaker`, `data-streaming`, `data-stop` and `data-failed`. */
    readonly turn: Record<string, unknown>
    /** The element naming who spoke. */
    readonly speaker: Record<string, unknown>
    /** Who spoke: `'you'` or `'assistant'`. */
    readonly role: 'you' | 'assistant'
    /** Whether this is the answer still streaming. */
    get streaming(): boolean
    /** 53.36 — the element saying why the answer failed, `role="alert"`. */
    readonly failure: Record<string, unknown>
    /** 53.46 — the element holding what is shown under an answer that has ended. */
    readonly actions: Record<string, unknown>
    /** 53.46 — asks the question this answer answered again, in its place. */
    retry(): void
}

/** The parts `chat` hands back: `<ol {...talk.transcript}>`, `<form {...talk.composer}>`. */
export type ChatParts = {
    /** The conversation: the `turns` handed in, or one of the parts' own. */
    readonly turns: Reactive<AssistantTurn[]>
    /** Whether an answer is streaming. */
    get streaming(): boolean
    /** The root's attributes: `data-chat="root"` and `data-streaming`. */
    readonly root: Record<string, unknown>
    /** 53.39, 53.40 — the transcript: `role="log"`, kept at its bottom as `autoscroll`'s host. */
    readonly transcript: Record<string, unknown>
    /** 53.39 — the button taking a reader who scrolled up back down. */
    readonly jump: Record<string, unknown>
    /** A turn's parts, keyed by the turn and its place in `turns`. */
    turn(turn: AssistantTurn, index: number): ChatTurnParts
    /** A text piece's element. */
    readonly text: Record<string, unknown>
    /** An image piece's element: its `src`. */
    image(image: Image): Record<string, unknown>
    /** A tool call's elements: the call, with `data-status`, and its name, input and result. */
    tool(part: ToolPart): {
        readonly tool: Record<string, unknown>
        readonly name: Record<string, unknown>
        readonly input: Record<string, unknown>
        readonly result: Record<string, unknown>
        readonly status: 'running' | 'done' | 'failed'
    }
    /** A permission prompt's elements: the prompt, with `data-answer`, its name, its input, and the two buttons answering it. */
    permission(part: Permission): {
        readonly permission: Record<string, unknown>
        readonly name: Record<string, unknown>
        readonly input: Record<string, unknown>
        readonly allow: Record<string, unknown>
        readonly deny: Record<string, unknown>
        readonly answer: 'waiting' | 'allowed' | 'denied'
    }
    /** 53.17-53.20 — the composer: a `<form>` that sends, and takes images dropped on it or pasted into it. */
    readonly composer: Record<string, unknown>
    /** 53.33 — the text input: Enter sends, Shift+Enter breaks the line. */
    readonly input: Record<string, unknown>
    /** What is being written. */
    readonly draft: Reactive<string>
    /** The images attached to what is being written. */
    get attached(): readonly Image[]
    /** The element holding the attached images. */
    readonly attachments: Record<string, unknown>
    /** An attached image's elements: the image, and the button taking it off. */
    attachment(image: Image): {
        readonly attachment: Record<string, unknown>
        readonly image: Record<string, unknown>
        readonly remove: Record<string, unknown>
    }
    /** 53.34 — what was sent while an answer streamed, sent once it ends: `undefined` where nothing is. */
    get pending(): readonly AssistantTurnPart[] | undefined
    /** 53.34 — the element showing what is queued. */
    readonly queued: Record<string, unknown>
    /** 53.34 — the button dropping what is queued. */
    readonly cancel: Record<string, unknown>
    /** 53.35 — the button stopping the answer streaming. */
    readonly stop: Record<string, unknown>
    /** The submit button: disabled while there is nothing to send. */
    readonly send: Record<string, unknown>
}

const sourceOf = (image: Image) => `data:${image.mimeType};base64,${image.data}`

/** A conversation over an assistant handler, as parts: the transcript and the composer. */
export function chat(options: ChatOptions): ChatParts {
    const turns = options.turns ?? reactive<AssistantTurn[]>([])
    const disabled = () => live(options.disabled) === true
    const draft = reactive('')
    // 53.34 — what was sent while an answer streamed, sent once it ends unless it is cancelled.
    const queued = reactive<AssistantTurnPart[] | undefined>(undefined)
    const attached = reactive<Image[]>([])
    const streaming = reactive(false)
    // The answer in flight, which `stop` aborts.
    let asking: AbortController | undefined

    const empty = () => draft().trim() === '' && attached().length === 0

    function send() {
        const text = draft().trim()
        if (disabled() || empty()) return
        const pieces: AssistantTurnPart[] = [...attached()]
        if (text !== '') pieces.push({ type: 'text', text })
        draft.set('')
        attached.set([])
        if (streaming()) {
            queued.set([...(queued() ?? []), ...pieces])
            return
        }
        turns.patch((all) => {
            all.push(turnOf('user', pieces))
        })
        answerFrom()
    }

    // 53.46 — the question an answer answered, asked again in its place.
    function retry(index: number) {
        if (streaming()) return
        turns.patch((all) => {
            all.splice(index)
        })
        answerFrom()
    }

    // Asks for an answer to the conversation as it stands, and sends what was queued once it ends.
    async function answerFrom() {
        turns.patch((all) => {
            all.push(turnOf('assistant'))
        })
        const controller = new AbortController()
        asking = controller
        streaming.set(true)
        try {
            const events = options.ask(
                { messages: messages(turns()) },
                { signal: controller.signal },
            )
            for await (const event of events) {
                if (controller.signal.aborted) break
                turns.patch((all) => {
                    const answering = all[all.length - 1]
                    if (answering !== undefined) fold(answering, event)
                })
            }
            if (controller.signal.aborted) ended(controller, undefined)
        } catch (error) {
            ended(controller, error)
        } finally {
            streaming.set(false)
            asking = undefined
        }
        const next = queued.peek()
        if (next === undefined) return
        queued.set(undefined)
        turns.patch((all) => {
            all.push(turnOf('user', next))
        })
        answerFrom()
    }

    // 53.35, 53.36 — an answer `stop` ended is `stopped`; one that threw carries the failure's message.
    function ended(controller: AbortController, error: unknown) {
        turns.patch((all) => {
            const answering = all[all.length - 1]
            if (answering === undefined) return
            if (controller.signal.aborted) answering.stop = 'stopped'
            else answering.failed = messageOf(error)
        })
    }

    async function attach(files: File[]) {
        for (const file of files)
            try {
                const piece = await imagePiece(file)
                attached.patch((all) => {
                    all.push(piece)
                })
            } catch {
                // An image this browser cannot draw is left out.
            }
    }

    async function answer(id: string, allow: boolean) {
        turns.patch((all) => {
            for (const each of all)
                for (const part of each.parts)
                    if (part.type === 'permission' && part.id === id)
                        part.allowed = allow
        })
        await options.permit?.({ id, allow })
    }

    // 53.33 — Enter sends and Shift+Enter breaks the line; `hotkeys` leaves an input method's Enter be.
    const keys = hotkeys({ Enter: { run: () => send(), editable: true } })
    // 53.17-53.20 — images dropped on the composer or pasted into it.
    const drop = dropzone({ accept: imageFiles, paste: true, onfiles: attach })
    // 53.39 — the transcript kept at its bottom.
    const follow = autoscroll()

    const answering = (index: number) =>
        streaming() && index === turns().length - 1

    return {
        turns,
        get streaming() {
            return streaming()
        },
        root: {
            'data-chat': 'root',
            get 'data-streaming'() {
                return streaming() ? '' : undefined
            },
        },
        transcript: withPart(
            { 'data-chat': 'transcript', role: 'log', 'aria-live': 'polite' },
            follow.host,
        ),
        jump: follow.jump,
        turn(turn, index) {
            const role = turn.role === 'user' ? 'you' : 'assistant'
            return {
                turn: {
                    'data-chat': 'turn',
                    'data-speaker': role,
                    get 'data-streaming'() {
                        return answering(index) ? '' : undefined
                    },
                    'data-stop': turn.stop,
                    'data-failed': turn.failed === undefined ? undefined : '',
                },
                speaker: { 'data-chat': 'speaker' },
                role,
                get streaming() {
                    return answering(index)
                },
                failure: { 'data-chat': 'failure', role: 'alert' },
                actions: { 'data-chat': 'actions' },
                retry: () => retry(index),
            }
        },
        text: { 'data-chat': 'text' },
        image: (image) => ({ 'data-chat': 'image', src: sourceOf(image) }),
        tool(part) {
            const status =
                part.result === undefined
                    ? 'running'
                    : part.failed
                      ? 'failed'
                      : 'done'
            return {
                tool: { 'data-chat': 'tool', 'data-status': status },
                name: { 'data-chat': 'tool-name' },
                input: { 'data-chat': 'tool-input' },
                result: { 'data-chat': 'tool-result' },
                status,
            }
        },
        permission(part) {
            const answered =
                part.allowed === undefined
                    ? 'waiting'
                    : part.allowed
                      ? 'allowed'
                      : 'denied'
            const button = (allow: boolean) => ({
                type: 'button',
                'data-chat': allow ? 'allow' : 'deny',
                disabled:
                    options.permit === undefined || answered !== 'waiting',
                onclick: () => answer(part.id, allow),
            })
            return {
                permission: {
                    'data-chat': 'permission',
                    'data-answer': answered,
                },
                name: { 'data-chat': 'permission-name' },
                input: { 'data-chat': 'permission-input' },
                allow: button(true),
                deny: button(false),
                answer: answered,
            }
        },
        composer: withPart(
            {
                'data-chat': 'composer',
                onsubmit(event: SubmitEvent) {
                    event.preventDefault()
                    send()
                },
            },
            drop.host,
        ),
        input: {
            'data-chat': 'input',
            get 'aria-label'() {
                return live(options.label) ?? 'Message'
            },
            get disabled() {
                return disabled()
            },
            get value() {
                return draft()
            },
            oninput(event: Event) {
                draft.set((event.target as HTMLTextAreaElement).value)
            },
            onkeydown: keys,
        },
        draft,
        get attached() {
            return attached()
        },
        attachments: { 'data-chat': 'attachments' },
        attachment(image) {
            return {
                attachment: { 'data-chat': 'attachment' },
                image: { src: sourceOf(image) },
                remove: {
                    type: 'button',
                    'data-chat': 'remove',
                    'aria-label': 'Remove this image',
                    onclick: () =>
                        attached.patch((all) => {
                            const at = all.indexOf(image)
                            if (at >= 0) all.splice(at, 1)
                        }),
                },
            }
        },
        get pending() {
            return queued()
        },
        queued: { 'data-chat': 'queued' },
        cancel: {
            type: 'button',
            'data-chat': 'cancel',
            onclick: () => queued.set(undefined),
        },
        stop: {
            type: 'button',
            'data-chat': 'stop',
            onclick: () => asking?.abort(),
        },
        send: {
            type: 'submit',
            'data-chat': 'send',
            get disabled() {
                return disabled() || empty()
            },
        },
    }
}
