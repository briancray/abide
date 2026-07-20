import { GET } from 'abide/server/GET'
export default GET(({ who = 'world' }: { who?: string }) => `Hello from abide, ${who}!`)
