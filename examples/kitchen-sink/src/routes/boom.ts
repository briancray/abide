import type { ApiHandler } from 'belte/types/ApiHandler'

export const GET: ApiHandler = () => {
    throw new Error('intentional boom — demonstrating the 500 error path')
}
