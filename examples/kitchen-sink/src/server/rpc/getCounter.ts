import { GET } from '@briancray/belte/server/GET'
import { json } from '@briancray/belte/server/json'
import { counterState } from '../../counterState.ts'

export const getCounter = GET(() => json({ count: counterState.count }))
