import { rpc } from '@abide/abide/server'

/** Its path is its address, /getGreeting: the page imports it, and so does its test. */
export const getGreeting = rpc(
    ({ name }: { name: string }) => `Hello, ${name}`,
    {
        description: 'A greeting, by name.',
    },
)
