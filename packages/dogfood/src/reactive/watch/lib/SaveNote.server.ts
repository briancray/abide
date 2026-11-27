import { rpc } from '@abide/abide/server'

export const saveNote = rpc(({ note }: { id: string; note: string }) => note, {
    methods: ['POST'],
})
