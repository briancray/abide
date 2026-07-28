import { GET } from 'abide/server/GET'

// One GET RPC with a type-DERIVED schema (no hand-written schema) — CL1.2.
export default GET(({ name }: { name: string }) => `Hello, ${name}!`)
