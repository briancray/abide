import { rpc } from '@abide/abide/server'

// 16.111, 16.115 — the server's one value: read by `GET`, changed by the `PUT` and `PATCH` `methods` names.
export default rpc(
    { seats: 40 },
    {
        methods: ['GET', 'PUT', 'PATCH'],
        description: 'The seats the team holds.',
    },
)
