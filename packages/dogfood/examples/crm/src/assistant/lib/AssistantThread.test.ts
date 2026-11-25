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
            const messages = [
                ...document.querySelectorAll('[data-chat=message]'),
            ]
            expect(
                messages.map((message) => message.getAttribute('data-speaker')),
            ).toEqual(['you', 'assistant', 'assistant'])
            expect(
                document.querySelector('[data-chat=tool]')?.textContent,
            ).toBe('used searchContacts')
            expect(messages[2]?.querySelector('p')?.textContent).toBe(
                'Ada Lovelace is at Analytical Engines.',
            )
        },
        { request: new Request('http://crm.invalid/assistant') },
    )
})

// THE REVERT: keep the old answer on a retry, and the conversation reads you, assistant, assistant, assistant, assistant.
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
            const messages = [
                ...document.querySelectorAll('[data-chat=message]'),
            ]
            expect(
                messages.map((message) => message.getAttribute('data-speaker')),
            ).toEqual(['you', 'assistant', 'assistant'])
            expect(messages[2]?.querySelector('p')?.textContent).toBe(
                'Ada Lovelace is at Analytical Engines.',
            )
        },
        { request: new Request('http://crm.invalid/assistant') },
    )
})

// 53.107 — `submit` SENDS THE DRAFT as the composer does: a suggestion is written into the draft and
// sent. THE REVERT: have the CRM's `suggest` write the draft alone, and nothing is asked.
test('a suggestion is asked as if it were typed and sent', async () => {
    await using app = await createApp()
    await app.run(
        async () => {
            using _thread = await mount(AssistantThread({}))
            ;(
                [...document.querySelectorAll('button')].find(
                    (button) =>
                        button.textContent === 'Which company is Ada at?',
                ) as HTMLButtonElement
            ).click()
            await settled()
            const messages = [
                ...document.querySelectorAll('[data-chat=message]'),
            ]
            expect(
                messages.map((message) => message.getAttribute('data-speaker')),
            ).toEqual(['you', 'assistant', 'assistant'])
            expect(messages[0]?.querySelector('p')?.textContent).toBe(
                'Which company is Ada at?',
            )
        },
        { request: new Request('http://crm.invalid/assistant') },
    )
})
