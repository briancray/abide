// 53.37, 53.105, 53.106 — `chat`'s attach path, its dropzone's input driven by hand.

import { expect, test } from 'bun:test'

import { reactive } from '#shared'
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
