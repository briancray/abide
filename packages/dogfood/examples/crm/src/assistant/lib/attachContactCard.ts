import {
    type AssistantContent,
    assistantMessage,
    type ChatOptions,
} from '@abide/abide'

/**
 * A file attached to a question: a vCard as the contact's fields in words, every other file as
 * `assistantMessage` makes it. A card naming no one is refused.
 */
export const attachContactCard: NonNullable<ChatOptions['attach']> = async (
    file,
) => {
    if (!file.name.toLowerCase().endsWith('.vcf'))
        return (await assistantMessage('user', [file])).content
    const fields: string[] = []
    for (const line of (await file.text()).split(/\r?\n/)) {
        const [name = '', ...value] = line.split(':')
        const field = name.split(';')[0]?.toUpperCase()
        if (field === 'FN' || field === 'EMAIL' || field === 'TEL')
            fields.push(`${field}: ${value.join(':')}`)
    }
    if (!fields.some((field) => field.startsWith('FN: ')))
        throw new Error(`${file.name} names no contact.`)
    const card: AssistantContent = {
        type: 'text',
        text: `A contact card, ${file.name}:\n${fields.join('\n')}`,
    }
    return [card]
}
