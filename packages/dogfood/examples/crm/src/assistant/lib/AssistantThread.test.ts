import { expect, test } from 'bun:test'

import { createApp } from '@abide/abide/server'
import { mount, settled } from '@abide/harness/abide'

import AssistantThread from './AssistantThread.abide'

function ask(question: string) {
    const field = document.querySelector('textarea') as HTMLTextAreaElement
    field.value = question
    field.dispatchEvent(new Event('input', { bubbles: true }))
    field.dispatchEvent(
        new KeyboardEvent('keydown', {
            key: 'Enter',
            bubbles: true,
            cancelable: true,
        }),
    )
}

test('Enter asks, and the answer streams in with its tool call', async () => {
    await using app = await createApp()
    await app.run(
        async () => {
            using _thread = await mount(AssistantThread({}))
            ask('Which company is Ada at?')
            await settled()
            const turns = [...document.querySelectorAll('[data-chat=turn]')]
            expect(
                turns.map((turn) => turn.getAttribute('data-speaker')),
            ).toEqual(['you', 'assistant'])
            expect(
                document.querySelector('[data-chat=tool]')?.textContent,
            ).toBe('used searchContacts')
            expect(turns[1]?.querySelector('p')?.textContent).toBe(
                'Ada Lovelace is at Analytical Engines.',
            )
        },
        { request: new Request('http://crm.invalid/assistant') },
    )
})

// THE REVERT: keep the old answer on a retry, and the conversation reads you, assistant, assistant.
test('Ask again replaces the answer with a fresh one to the same question', async () => {
    await using app = await createApp()
    await app.run(
        async () => {
            using _thread = await mount(AssistantThread({}))
            ask('Which company is Ada at?')
            await settled()
            ;(
                [...document.querySelectorAll('button')].find(
                    (button) => button.textContent === 'Ask again',
                ) as HTMLButtonElement
            ).click()
            await settled()
            const turns = [...document.querySelectorAll('[data-chat=turn]')]
            expect(
                turns.map((turn) => turn.getAttribute('data-speaker')),
            ).toEqual(['you', 'assistant'])
            expect(turns[1]?.querySelector('p')?.textContent).toBe(
                'Ada Lovelace is at Analytical Engines.',
            )
        },
        { request: new Request('http://crm.invalid/assistant') },
    )
})
