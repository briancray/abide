import { json } from 'belte/respond'
import { GET } from 'belte/route'
import { counterState } from '../counterState.ts'

export const getCounter = GET(() => json({ count: counterState.count }))
