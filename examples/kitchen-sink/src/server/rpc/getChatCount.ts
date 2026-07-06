import { GET } from '@abide/abide/server/GET'
import { json } from '@abide/abide/server/json'
import { chatState } from '../../chatState.ts'

/*
A read the chat socket's frames make stale — the reactive-state page runs
`watch(chat, () => refresh(getChatCount))` so every message revalidates the
cached copy, keeping the stale count visible until the fresh one lands.
*/
export const getChatCount = GET(() => json({ published: chatState.published }))
