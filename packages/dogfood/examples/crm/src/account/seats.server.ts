import { rpc } from '@abide/abide/server'

// 16.111, 16.115 — the server's one value: read by `GET`, changed by `PUT` and `PATCH`.
export default rpc({ seats: 40 }, { description: 'The seats the team holds.' })
