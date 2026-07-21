import { GET } from 'abide/server/GET'
export default GET(({ who = 'world' }) => `Hello from abide, ${who}!`)
