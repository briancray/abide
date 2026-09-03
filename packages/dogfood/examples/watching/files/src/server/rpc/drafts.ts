import { POST } from 'abide/server'
import { database } from '#server/database'

export const saveDraft = POST(({ body }: { body: string }) =>
    database.draft.write(body),
)
