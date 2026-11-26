// 53.31-53.40, 53.105-53.108 — A CONVERSATION OVER AN ASSISTANT HANDLER, as parts: the messages as they
// stream, and a composer that sends its draft — the user message being written — on Enter. The conversation is the Messages API's own messages (44.105), and an
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
import { type Autoscroll, autoscroll } from './autoscroll.ts'
import { callsOf, type ChatCall } from './callsOf.ts'
import { dropzone, type DropzoneParts } from './dropzone.ts'
import { hotkeys } from './hotkeys.ts'
import { isSendable } from './isSendable.ts'
import { type Live, live } from './live.ts'
import { MessageAccumulator } from './MessageAccumulator.ts'
import { messageOf } from './messageOf.ts'
import { reactive } from './reactive/index.ts'
import type { Reactive } from './reactive/Reactive.ts'
import type { Rpc } from './rpc.ts'
import { wordsOf } from './wordsOf.ts'

type Text = Extract<AssistantContent, { type: 'text' }>
type Image = Extract<AssistantContent, { type: 'image' }>
type Document = Extract<AssistantContent, { type: 'document' }>
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
    messages?: Reactive<AssistantMessage[]> | undefined
    /** The input's accessible name. `'Message'` by default. */
    label?: Live<string | undefined> | undefined
    /** Whether the composer refuses to send: a provider not yet paired, say. */
    disabled?: Live<boolean | undefined> | undefined
    /** 49.8, 53.105 — the user message being written: bind it to put a question back. Held by the parts, empty, where none is given. */
    draft?: Reactive<AssistantMessage> | undefined
    /** The files its `dropzone` takes, as an `<input accept>` writes them: every file `assistantMessage` carries by default; a function is read live. */
    accept?: Live<string> | undefined
    /** 53.37 — a file taken as the blocks it answers: `assistantMessage`'s by default. */
    attach?: ((file: File) => Promise<AssistantContent[]>) | undefined
    /** 53.37 — handed the files its `dropzone` turned away, and the files `attach` threw on. */
    onreject?: ((files: File[], event: Event) => void) | undefined
}

/** A message's parts: its element, its speaker, its blocks, and what is shown under an answer. */
export type ChatMessageParts = {
    /** The message's element: `data-speaker`, `data-streaming` and `data-ends`. */
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
    /** 53.40 — the transcript: `role="log"`. */
    readonly transcript: Record<string, unknown>
    /** 49.18, 53.39 — what keeps the transcript at its bottom: its `host` spread with `transcript`, its `jump` the button taking a reader back down. */
    readonly autoscroll: Autoscroll
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
    /** 53.109 — every call in the conversation to `handler`, in order, each typed by the handler: live while it streams. */
    calls<Input, Value>(
        handler: ((
            args: Input,
            ...rest: never[]
        ) => Promise<Value> | AsyncIterable<Value>) &
            Pick<Rpc<Value, never>, 'tool'>,
    ): ChatCall<Input, Value>[]
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
    /** The composer: a `<form>` that sends, with `data-attaching` while a file is being taken. */
    readonly composer: Record<string, unknown>
    /** 49.18, 53.39 — where files are taken: its `host` dropped on or pasted into, its `input` a file picker. */
    readonly dropzone: DropzoneParts
    /** 53.33, 53.105 — the text input: Enter sends, Shift+Enter breaks the line. */
    readonly input: Record<string, unknown>
    /** 53.105 — the user message being written: its words and what is attached, in order. */
    readonly draft: Reactive<AssistantMessage>
    /** 53.106 — the blocks of `draft` the input does not show: each file's, in order. */
    get attached(): readonly AssistantContent[]
    /** 53.108 — whether a file is still being taken. */
    get attaching(): boolean
    /** 53.37 — the files the last drop, paste or pick turned away, and those `attach` threw on. */
    get rejected(): readonly File[]
    /** 53.107 — sends what `draft` holds, as the composer does. */
    submit(): void
    /** The element holding what is attached. */
    readonly attachments: Record<string, unknown>
    /** An attachment's elements: the attachment, with `data-type`, an image's `src`, and the button taking it out of `draft`. */
    attachment(attached: AssistantContent): {
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

/** A message's content as blocks: words written as a string are one text block, and none held, none. */
function blocksOf(message: AssistantMessage | undefined): AssistantContent[] {
    if (message === undefined) return []
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

const blank = (): AssistantMessage => ({ role: 'user', content: [] })

// What a file is taken as where the app names no `attach`.
const converted = async (file: File) =>
    (await assistantMessage('user', [file])).content

/** A conversation over an assistant handler, as parts: the transcript and the composer. */
export function chat(options: ChatOptions): ChatParts {
    const messages = options.messages ?? reactive<AssistantMessage[]>([])
    const disabled = () => live(options.disabled) === true
    const draft = options.draft ?? reactive<AssistantMessage>(blank())
    // 53.105 — the text blocks `attach` made, which the input leaves alone. A block keeps its
    // identity into the transcript, so a question put back into `draft` keeps its files apart.
    const fromFiles = new WeakSet<AssistantContent>()
    const typed = (block: AssistantContent): block is Text =>
        block.type === 'text' && !fromFiles.has(block)
    // 53.34 — what was sent while an answer streamed, sent once it ends unless it is cancelled.
    const queued = reactive<AssistantContent[] | undefined>(undefined)
    // 53.108 — how many `attach` calls are in flight, and whether a send waits on them.
    const converting = reactive(0)
    let held = false
    // 53.37 — the files `attach` threw on, for the latest drop, paste or pick.
    const thrownOn = reactive<readonly File[]>([])
    let transfers = 0
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

    const empty = () => {
        if (converting() > 0) return false
        for (const block of blocksOf(draft()))
            if (isSendable(block)) return false
        return true
    }

    // 53.107 — what `draft` holds goes as it stands, a blank text block left out.
    function submit() {
        if (disabled()) return
        if ((converting.peek() ?? 0) > 0) {
            held = true
            return
        }
        const content: AssistantContent[] = []
        for (const block of blocksOf(draft.peek()))
            if (isSendable(block)) content.push(block)
        if (content.length === 0) return
        // 53.107, 49.19
        if (draft.set(blank()) !== undefined) return
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

    // 53.105 — the input's edit, as one text block where the first typed one stood.
    function write(text: string) {
        const content: AssistantContent[] = []
        let placed = false
        for (const block of blocksOf(draft.peek())) {
            if (!typed(block)) content.push(block)
            else if (!placed) {
                placed = true
                content.push({ type: 'text', text })
            }
        }
        if (!placed) content.push({ type: 'text', text })
        draft.set({ role: 'user', content })
    }

    // 53.37, 53.106 — each file as `attach` answers it, appended as it lands so its image shows at once.
    async function take(files: File[], event: Event) {
        const transfer = ++transfers
        thrownOn.set([])
        converting.set((converting.peek() ?? 0) + files.length)
        const threw: File[] = []
        for (const file of files) {
            let blocks: AssistantContent[] | undefined
            try {
                blocks = await (options.attach ?? converted)(file)
            } catch {
                threw.push(file)
            }
            if (
                blocks !== undefined &&
                blocks.length > 0 &&
                draft.set({
                    role: 'user',
                    content: [...blocksOf(draft.peek()), ...blocks],
                }) === undefined
            )
                for (const block of blocks) fromFiles.add(block)
            converting.set((converting.peek() ?? 0) - 1)
        }
        if (threw.length > 0) {
            if (transfer === transfers) thrownOn.set(threw)
            options.onreject?.(threw, event)
        }
        // 53.108 — a send pressed while files were being taken goes once the last has landed.
        if (held && (converting.peek() ?? 0) === 0) {
            held = false
            submit()
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
    const keys = hotkeys({ Enter: { run: () => submit(), editable: true } })
    // 53.39 — files dropped, pasted or picked, and the transcript kept at its bottom.
    const drop = dropzone({
        accept: options.accept ?? ATTACHABLE,
        paste: true,
        onfiles: take,
        onreject(files, event) {
            thrownOn.set([])
            options.onreject?.(files, event)
        },
    })
    const follow = autoscroll()

    const answering = (index: number) => streaming() && index >= answerStart
    // 53.29 — an assistant message followed by nothing, or by one the person wrote.
    const endsAnswer = (message: AssistantMessage, index: number) => {
        if (message.role !== 'assistant') return false
        const next = messages()[index + 1]
        return next === undefined || written(next)
    }

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
        transcript: {
            'data-chat': 'transcript',
            role: 'log',
            'aria-live': 'polite',
        },
        autoscroll: follow,
        message(message, index) {
            const role = message.role === 'user' ? 'you' : 'assistant'
            return {
                message: {
                    'data-chat': 'message',
                    'data-speaker': role,
                    get 'data-streaming'() {
                        return answering(index) ? '' : undefined
                    },
                    // 49.1, 53.29 — the state `ends` reads, for a caller to style.
                    get 'data-ends'() {
                        return endsAnswer(message, index) ? '' : undefined
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
                    return endsAnswer(message, index)
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
        // 53.109
        calls: (handler) => callsOf(messages(), handler.tool, streaming()),
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
        composer: {
            'data-chat': 'composer',
            get 'data-attaching'() {
                return converting() > 0 ? '' : undefined
            },
            onsubmit(event: SubmitEvent) {
                event.preventDefault()
                submit()
            },
        },
        dropzone: drop,
        input: {
            'data-chat': 'input',
            get 'aria-label'() {
                return live(options.label) ?? 'Message'
            },
            get disabled() {
                return disabled()
            },
            // 53.105 — the typed text blocks, a line apart.
            get value() {
                let text: string | undefined
                for (const block of blocksOf(draft()))
                    if (typed(block))
                        text =
                            text === undefined
                                ? block.text
                                : `${text}\n${block.text}`
                return text ?? ''
            },
            oninput(event: Event) {
                write((event.target as HTMLTextAreaElement).value)
            },
            onkeydown: keys,
        },
        draft,
        get attached() {
            const others: AssistantContent[] = []
            for (const block of blocksOf(draft()))
                if (!typed(block)) others.push(block)
            return others
        },
        get attaching() {
            return converting() > 0
        },
        get rejected() {
            const thrown = thrownOn()
            return thrown.length === 0
                ? drop.rejected
                : [...drop.rejected, ...thrown]
        },
        submit,
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
                            : piece.type === 'document'
                              ? `Remove ${piece.title ?? 'this document'}`
                              : 'Remove this attachment',
                    onclick() {
                        const content: AssistantContent[] = []
                        for (const block of blocksOf(draft.peek()))
                            if (block !== piece) content.push(block)
                        draft.set({ role: 'user', content })
                    },
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
