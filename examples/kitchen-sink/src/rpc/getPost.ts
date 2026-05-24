import { handler } from 'belte/rpc/handler'

/*
Stand-in for a posts table. Demonstrates an RPC that takes a JSON-ish arg
(`id`) and looks it up — the same as a REST `GET /posts/:id`, just
expressed as a function call (`getPost({ id })`) over `/rpc/getPost?id=...`.
*/
const posts: Record<string, { id: string; title: string }> = {
    '1': { id: '1', title: 'Hello' },
    '2': { id: '2', title: 'World' },
}

export const getPost = handler.GET<{ id: string }, { id: string; title: string } | null>((args) =>
    Response.json(posts[args.id] ?? null),
)
