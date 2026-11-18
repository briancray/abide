import { refuse } from '@abide/abide'
import { POST } from '@abide/abide/server'

/** Answers at /contacts/savePhone: a number too short to dial is refused. */
export default POST(
    ({ phone }: { phone: string }) => {
        const digits = phone.replace(/\D/g, '')
        if (digits.length < 7)
            return refuse(400, 'A phone number needs at least seven digits.')
        return { phone: digits }
    },
    { description: "Saves a contact's phone number." },
)
