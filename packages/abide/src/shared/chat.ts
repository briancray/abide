// 53.31-53.40 — A CONVERSATION OVER AN ASSISTANT HANDLER, as parts: the messages as they stream, and a
// composer that sends on Enter. The conversation is the Messages API's own messages (44.105), and an
// answer's events are folded into them one at a time, in place — 53.32 — so a delta extends the
// block it lands in and nothing before it. What the API has no place for — a permission prompt
// waiting, why the latest answer ended or failed — is the parts' own, never the history's. The markup
// — how a message, a tool call or a prompt reads — is the app's; what a conversation DOES is here.

import type {
    AssistantContent,
    AssistantEvent,
    AssistantMessage,
} from './AssistantEvent.ts'
import { assistantMessage, ATTACHABLE } from './assistantMessage.ts'
import { autoscroll } from './autoscroll.ts'
import { dropzone } from './dropzone.ts'
import { hotkeys } from './hotkeys.ts'
import { type Live, live } from './live.ts'
import { MessageAccumulator } from './MessageAccumulator.ts'
import { messageOf } from './messageOf.ts'
import { reactive } from './reactive/index.ts'
import type { Reactive } from './reactive/Reactive.ts'
import { withPart } from './withPart.ts'
import { wordsOf } from './wordsOf.ts'

type Image = Extract<AssistantContent, { type: 'image' }>
type Document = Extract<AssistantContent, { type: 'document' }>
type Attached = Image | Document
type ToolUse = Extract<AssistantContent, { type: 'tool_use' }>
type ToolResult = Extract<AssistantContent, { type: 'tool_result' }>

/** A permission prompt Claude Code asks the page, and the visitor's answer, `undefined` while it waits. */
export type ChatPermission = {
    id: string
    name: string
    input: unknown
    allowed: boolean | undefined
}

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
    messages?: Reactive<AssistantMessage[]>
    /** The input's accessible name. `'Message'` by default. */
    label?: Live<string | undefined>
    /** Whether the composer refuses to send: a provider not yet paired, say. */
    disabled?: Live<boolean | undefined>
}

/** A message's parts: its element, its speaker, its blocks, and what is shown under an answer. */
export type ChatMessageParts = {
    /** The message's element: `data-speaker` and `data-streaming`. */
    readonly message: Record<string, unknown>
    /** The element naming who spoke. */
    readonly speaker: Record<string, unknown>
    /** Who spoke: `'you'` or `'assistant'`. */
    readonly role: 'you' | 'assistant'
    /** 53.28 — whether it is shown: a user message holding only what tools answered is not. */
    readonly shown: boolean
    /** Its blocks in order — its words as one where they are a string — each tool's result left to its call. */
    get blocks(): readonly AssistantContent[]
    /** Whether it belongs to the answer still streaming. */
    get streaming(): boolean
    /** 53.46 — whether it is an answer's last message: what follows it, if anything, the person wrote. */
    get ends(): boolean
    /** 53.46 — the element holding what is shown under an answer that has ended. */
    readonly actions: Record<string, unknown>
    /** 53.46 — asks the question this answer answered again, in its place. */
    retry(): void
}

/** The parts `chat` hands back: `<ol {...talk.transcript}>`, `<form {...talk.composer}>`. */
export type ChatParts = {
    /** The conversation: the `messages` handed in, or one of the parts' own. */
    readonly messages: Reactive<AssistantMessage[]>
    /** Whether an answer is streaming. */
    get streaming(): boolean
    /** 53.35 — why the latest answer ended, as its last run said (`end_turn`), or `stopped`; `undefined` while it runs. */
    get stop_reason(): string | undefined
    /** 53.36 — the message the latest answer failed with, or `undefined`. */
    get failed(): string | undefined
    /** The root's attributes: `data-chat="root"`, `data-streaming`, `data-stop` and `data-failed`. */
    readonly root: Record<string, unknown>
    /** 53.39, 53.40 — the transcript: `role="log"`, kept at its bottom as `autoscroll`'s host. */
    readonly transcript: Record<string, unknown>
    /** 53.39 — the button taking a reader who scrolled up back down. */
    readonly jump: Record<string, unknown>
    /** A message's parts, keyed by the message and its place in `messages`. */
    message(message: AssistantMessage, index: number): ChatMessageParts
    /** A text block's element. */
    readonly text: Record<string, unknown>
    /** An image block's element: its `src`. */
    image(image: Image): Record<string, unknown>
    /** A document block's element: `data-chat="document"`, its `title` the file's name. */
    document(document: Document): Record<string, unknown>
    /** 53.25 — a tool call's elements, with `data-status`, and the result its call was answered with. */
    tool(call: ToolUse): {
        readonly tool: Record<string, unknown>
        readonly name: Record<string, unknown>
        readonly input: Record<string, unknown>
        readonly result: Record<string, unknown>
        readonly status: 'running' | 'done' | 'failed'
        /** The `tool_result` block answering the call, `undefined` while it runs. */
        readonly toolResult: ToolResult | undefined
        /** What it answered, in words, `undefined` while it runs. */
        readonly answer: string | undefined
    }
    /** 53.26 — the permission prompts the answer streaming asks, each with the visitor's answer. */
    get permissions(): readonly ChatPermission[]
    /** A permission prompt's elements: the prompt, with `data-answer`, its name, its input, and the two buttons answering it. */
    permission(prompt: ChatPermission): {
        readonly permission: Record<string, unknown>
        readonly name: Record<string, unknown>
        readonly input: Record<string, unknown>
        readonly allow: Record<string, unknown>
        readonly deny: Record<string, unknown>
        readonly answer: 'waiting' | 'allowed' | 'denied'
    }
    /** 53.36 — the element saying why the latest answer failed, `role="alert"`. */
    readonly failure: Record<string, unknown>
    /** 53.17-53.20 — the composer: a `<form>` that sends, and takes files dropped on it or pasted into it. */
    readonly composer: Record<string, unknown>
    /** 53.33 — the text input: Enter sends, Shift+Enter breaks the line. */
    readonly input: Record<string, unknown>
    /** What is being written. */
    readonly draft: Reactive<string>
    /** The images and documents attached to what is being written. */
    get attached(): readonly Attached[]
    /** The element holding what is attached. */
    readonly attachments: Record<string, unknown>
    /** An attachment's elements: the attachment, with `data-type`, an image's `src`, and the button taking it off. */
    attachment(attached: Attached): {
        readonly attachment: Record<string, unknown>
        readonly image: Record<string, unknown>
        readonly remove: Record<string, unknown>
    }
    /** 53.34 — what was sent while an answer streamed, sent once it ends: `undefined` where nothing is. */
    get pending(): readonly AssistantContent[] | undefined
    /** 53.34 — the element showing what is queued. */
    readonly queued: Record<string, unknown>
    /** 53.34 — the button dropping what is queued. */
    readonly cancel: Record<string, unknown>
    /** 53.35 — the button stopping the answer streaming. */
    readonly stop: Record<string, unknown>
    /** The submit button: disabled while there is nothing to send. */
    readonly send: Record<string, unknown>
}

// An image shows from its bytes or its URL; one uploaded to the Files API has nothing a page can show.
const sourceOf = (image: Image) =>
    image.source.type === 'base64'
        ? `data:${image.source.media_type};base64,${image.source.data}`
        : image.source.type === 'url'
          ? image.source.url
          : undefined

// The events that write a block or a message; the rest change nothing a page renders.
const WRITES = new Set<AssistantEvent['type']>([
    'message_start',
    'content_block_start',
    'content_block_delta',
    'content_block_stop',
    'tool_result',
])

/** A message's content as blocks: words written as a string are one text block. */
function blocksOf(message: AssistantMessage): AssistantContent[] {
    return typeof message.content === 'string'
        ? [{ type: 'text', text: message.content }]
        : message.content
}

/** Whether `message` is what the person wrote, rather than what tools answered in their turn. */
function written(message: AssistantMessage): boolean {
    if (message.role !== 'user') return false
    for (const block of blocksOf(message))
        if (block.type !== 'tool_result') return true
    return false
}

/** A conversation over an assistant handler, as parts: the transcript and the composer. */
export function chat(options: ChatOptions): ChatParts {
    const messages = options.messages ?? reactive<AssistantMessage[]>([])
    const disabled = () => live(options.disabled) === true
    const draft = reactive('')
    // 53.34 — what was sent while an answer streamed, sent once it ends unless it is cancelled.
    const queued = reactive<AssistantContent[] | undefined>(undefined)
    const attached = reactive<Attached[]>([])
    const streaming = reactive(false)
    const permissions = reactive<ChatPermission[]>([])
    const outcome = reactive<{
        stop_reason: string | undefined
        failed: string | undefined
    }>({ stop_reason: undefined, failed: undefined })
    // Where the answer streaming begins in `messages`.
    let answerStart = 0
    // The answer in flight, which `stop` aborts.
    let asking: AbortController | undefined

    const empty = () => draft().trim() === '' && attached().length === 0

    function send() {
        const text = draft().trim()
        if (disabled() || empty()) return
        const content: AssistantContent[] = [...attached()]
        if (text !== '') content.push({ type: 'text', text })
        draft.set('')
        attached.set([])
        if (streaming()) {
            queued.set([...(queued() ?? []), ...content])
            return
        }
        messages.patch((all) => {
            all.push({ role: 'user', content })
        })
        answerFrom()
    }

    // 53.46 — the question an answer answered, asked again in its place: everything after the last
    // message the person wrote before it goes.
    function retry(index: number) {
        if (streaming()) return
        const all = messages()
        let asked = index
        while (asked > 0 && !written(all[asked] as AssistantMessage)) asked--
        messages.patch((held) => {
            held.splice(asked + 1)
        })
        answerFrom()
    }

    // Asks for an answer to the conversation as it stands, and sends what was queued once it ends.
    async function answerFrom() {
        const controller = new AbortController()
        asking = controller
        answerStart = messages().length
        const accumulator = new MessageAccumulator(answerStart)
        permissions.set([])
        outcome.set({ stop_reason: undefined, failed: undefined })
        streaming.set(true)
        let stop: string | undefined
        try {
            const events = options.ask(
                { messages: messages() },
                { signal: controller.signal },
            )
            for await (const event of events) {
                if (controller.signal.aborted) break
                if (WRITES.has(event.type))
                    messages.patch((all) => {
                        accumulator.add(all, event)
                    })
                else if (event.type === 'permission')
                    permissions.patch((all) => {
                        all.push({
                            id: event.id,
                            name: event.name,
                            input: event.input,
                            allowed: undefined,
                        })
                    })
                else if (event.type === 'message_delta')
                    stop = event.delta.stop_reason ?? undefined
                // A run's end changes nothing a page renders, so nothing is told it did.
                else
                    accumulator.add(
                        messages.peek() as AssistantMessage[],
                        event,
                    )
            }
            outcome.set({
                stop_reason: controller.signal.aborted ? 'stopped' : stop,
                failed: undefined,
            })
        } catch (error) {
            // 53.35, 53.36 — an answer `stop` ended is `stopped`; one that threw carries the failure's message.
            outcome.set(
                controller.signal.aborted
                    ? { stop_reason: 'stopped', failed: undefined }
                    : { stop_reason: undefined, failed: messageOf(error) },
            )
        } finally {
            // 53.28 — a call left unanswered goes, so the conversation is one the API takes back.
            messages.patch((all) => {
                accumulator.settle(all)
            })
            streaming.set(false)
            asking = undefined
        }
        const next = queued.peek()
        if (next === undefined) return
        queued.set(undefined)
        messages.patch((all) => {
            all.push({ role: 'user', content: next })
        })
        answerFrom()
    }

    // 53.37 — each file as `assistantMessage` makes it, taken when it lands so its image shows at once.
    async function attach(files: File[]) {
        for (const file of files)
            try {
                const { content } = await assistantMessage('user', [file])
                attached.patch((all) => {
                    for (const block of content)
                        if (block.type === 'image' || block.type === 'document')
                            all.push(block)
                })
            } catch {
                // A file this browser cannot draw, or none a model reads, is left out.
            }
    }

    async function answer(id: string, allow: boolean) {
        permissions.patch((all) => {
            for (const prompt of all)
                if (prompt.id === id) prompt.allowed = allow
        })
        await options.permit?.({ id, allow })
    }

    // The result answering the call `id`, read from the messages after it.
    function resultOf(id: string): ToolResult | undefined {
        for (const message of messages())
            if (message.role === 'user' && typeof message.content !== 'string')
                for (const block of message.content)
                    if (
                        block.type === 'tool_result' &&
                        block.tool_use_id === id
                    )
                        return block
        return undefined
    }

    // 53.33 — Enter sends and Shift+Enter breaks the line; `hotkeys` leaves an input method's Enter be.
    const keys = hotkeys({ Enter: { run: () => send(), editable: true } })
    // 53.17-53.20 — files dropped on the composer or pasted into it.
    const drop = dropzone({ accept: ATTACHABLE, paste: true, onfiles: attach })
    // 53.39 — the transcript kept at its bottom.
    const follow = autoscroll()

    const answering = (index: number) => streaming() && index >= answerStart

    return {
        messages,
        get streaming() {
            return streaming()
        },
        get stop_reason() {
            return outcome().stop_reason
        },
        get failed() {
            return outcome().failed
        },
        root: {
            'data-chat': 'root',
            get 'data-streaming'() {
                return streaming() ? '' : undefined
            },
            get 'data-stop'() {
                return outcome().stop_reason
            },
            get 'data-failed'() {
                return outcome().failed === undefined ? undefined : ''
            },
        },
        transcript: withPart(
            { 'data-chat': 'transcript', role: 'log', 'aria-live': 'polite' },
            follow.host,
        ),
        jump: follow.jump,
        message(message, index) {
            const role = message.role === 'user' ? 'you' : 'assistant'
            return {
                message: {
                    'data-chat': 'message',
                    'data-speaker': role,
                    get 'data-streaming'() {
                        return answering(index) ? '' : undefined
                    },
                },
                speaker: { 'data-chat': 'speaker' },
                role,
                shown: message.role === 'assistant' || written(message),
                // Read as the answer grows: a block streaming in is shown the moment it starts.
                get blocks() {
                    const shownBlocks: AssistantContent[] = []
                    for (const block of blocksOf(message))
                        if (block.type !== 'tool_result')
                            shownBlocks.push(block)
                    return shownBlocks
                },
                get streaming() {
                    return answering(index)
                },
                get ends() {
                    if (message.role !== 'assistant') return false
                    const next = messages()[index + 1]
                    return next === undefined || written(next)
                },
                actions: { 'data-chat': 'actions' },
                retry: () => retry(index),
            }
        },
        text: { 'data-chat': 'text' },
        image: (image) => ({ 'data-chat': 'image', src: sourceOf(image) }),
        document: (document) => ({
            'data-chat': 'document',
            title: document.title,
        }),
        tool(call) {
            const toolResult = resultOf(call.id)
            const status =
                toolResult === undefined
                    ? 'running'
                    : toolResult.is_error === true
                      ? 'failed'
                      : 'done'
            return {
                tool: { 'data-chat': 'tool', 'data-status': status },
                name: { 'data-chat': 'tool-name' },
                input: { 'data-chat': 'tool-input' },
                result: { 'data-chat': 'tool-result' },
                status,
                toolResult,
                answer:
                    toolResult === undefined
                        ? undefined
                        : wordsOf(toolResult.content),
            }
        },
        get permissions() {
            return permissions()
        },
        permission(prompt) {
            const answered =
                prompt.allowed === undefined
                    ? 'waiting'
                    : prompt.allowed
                      ? 'allowed'
                      : 'denied'
            const button = (allow: boolean) => ({
                type: 'button',
                'data-chat': allow ? 'allow' : 'deny',
                disabled:
                    options.permit === undefined || answered !== 'waiting',
                onclick: () => answer(prompt.id, allow),
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
        failure: { 'data-chat': 'failure', role: 'alert' },
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
        attachment(piece) {
            return {
                attachment: {
                    'data-chat': 'attachment',
                    'data-type': piece.type,
                },
                image: {
                    src: piece.type === 'image' ? sourceOf(piece) : undefined,
                },
                remove: {
                    type: 'button',
                    'data-chat': 'remove',
                    'aria-label':
                        piece.type === 'image'
                            ? 'Remove this image'
                            : `Remove ${piece.title ?? 'this document'}`,
                    onclick: () =>
                        attached.patch((all) => {
                            const at = all.indexOf(piece)
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
