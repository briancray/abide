import { GET } from '@abide/abide/server'

/** Its path is its address, /getGreeting: the page imports it, and so does its test. */
export default GET(({ name }: { name: string }) => `Hello, ${name}`, {
    description: 'A greeting, by name.',
})
