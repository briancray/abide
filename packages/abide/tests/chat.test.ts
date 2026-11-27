// 53.37, 53.105, 53.106, 53.107 — `chat`'s attach and send paths, its parts driven by hand.

import { expect, test } from 'bun:test'

import { rpc } from '#server'
import { reactive, refuse } from '#shared'
import type {
    AssistantContent,
    AssistantMessage,
} from '#shared/AssistantEvent.ts'
import { chat } from '#shared/chat.ts'

// THE REVERT: mark the blocks `attach` made before writing `draft`, unchecked, and the block a refused
// draft never took is still read as attached once the app writes it as words — `attached` holds it.
test('a file whose blocks the draft refuses leaves them unmarked as attached — 49.19', async () => {
    const gate = { refusing: false }
    const draft = reactive<AssistantMessage>(
        { role: 'user', content: [] },
        {
            schema: {
                '~standard': {
                    version: 1,
                    vendor: 'test',
                    validate: (value: unknown) =>
                        gate.refusing
                            ? { issues: [{ message: 'no files now' }] }
                            : { value: value as AssistantMessage },
                },
            },
        },
    )
    const made: AssistantContent = { type: 'text', text: 'Hopper notes' }
    const talk = chat({
        ask: async function* () {},
        draft,
        attach: async () => [made],
    })
    gate.refusing = true
    const picker = document.createElement('input')
    Object.defineProperty(picker, 'files', {
        value: [new File(['x'], 'notes.txt', { type: 'text/plain' })],
    })
    Object.defineProperty(picker, 'value', { writable: true, value: '' })
    picker.addEventListener(
        'change',
        talk.dropzone.input.onchange as EventListener,
    )
    picker.dispatchEvent(new Event('change'))
    await Bun.sleep(0)
    expect(draft.peek()?.content).toEqual([])
    gate.refusing = false
    draft.set({ role: 'user', content: [made] })
    expect(talk.attached).toEqual([])
})

// THE REVERT: send whatever clearing `draft` answered, and the refused send still asks — `asked`
// reads 1 and the message is in `messages`.
test('a send whose clearing the draft refuses sends nothing — 53.107, 49.19', async () => {
    const gate = { refusing: false }
    const draft = reactive<AssistantMessage>(
        {
            role: 'user',
            content: [{ type: 'text', text: 'Quote for Hopper?' }],
        },
        {
            schema: {
                '~standard': {
                    version: 1,
                    vendor: 'test',
                    validate: (value: unknown) =>
                        gate.refusing
                            ? { issues: [{ message: 'keep the draft' }] }
                            : { value: value as AssistantMessage },
                },
            },
        },
    )
    let asked = 0
    const talk = chat({
        ask: async function* () {
            asked += 1
        },
        draft,
    })
    gate.refusing = true
    talk.submit()
    await Bun.sleep(0)
    expect([asked, talk.messages.peek()?.length ?? 0]).toEqual([0, 0])
    expect(draft.peek()?.content).toEqual([
        { type: 'text', text: 'Quote for Hopper?' },
    ])
})

// 53.47 — `messages` ADOPTING A HANDLER'S CALL IS TAKEN AS IT IS, its `HttpError` and the handler's
// refusals among its failures, and while it is failed `failed` says why and nothing is sent.
// THE REVERT, of the type: type `messages` as `Reactive<AssistantMessage[]>` again, and `bun run
// typecheck` refuses `messages: conversation` (TS2322, `Failed<"HttpError", undefined>` is not
// assignable to type `never`). Of the behavior: drop `messages.error()` from `disabled` and `failed`,
// and `submit` throws from `messages.patch` — `NotLanded: memo({"id":"missing"}) has not landed`.
test('a conversation that failed to load says so in failed and sends nothing — 53.47', async () => {
    const getConversation = rpc(
        ({
            id,
        }: {
            id: string
        }): AssistantMessage[] | ReturnType<typeof refuse> =>
            id === 'missing' ? refuse(404, 'No such conversation.') : [],
    )
    const conversation = reactive(() => getConversation({ id: 'missing' }))
    let asked = 0
    const talk = chat({
        ask: async function* () {
            asked += 1
        },
        messages: conversation,
        draft: reactive<AssistantMessage>({
            role: 'user',
            content: [{ type: 'text', text: 'Quote for Hopper?' }],
        }),
    })
    await Promise.resolve(conversation).then(
        () => undefined,
        () => undefined,
    )
    talk.submit()
    await Bun.sleep(0)
    expect(`asked ${asked}, failed ${talk.failed}`).toBe(
        'asked 0, failed No such conversation.',
    )
})
