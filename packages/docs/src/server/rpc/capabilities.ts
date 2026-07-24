import { GET } from 'abide/server/GET'

export interface Capability {
    name: string
    path: string
    blurb: string
}

// Zero-arg read RPC: the capability index that powers the home page and the machine surface. Cached
// and coalesced by the memo like any read; reachable over HTTP at /rpc/capabilities, OpenAPI, and MCP.
// #demo capabilities
export default GET((): Capability[] => [
    {
        name: 'Isomorphic RPC',
        path: '/rpc',
        blurb: 'One callable, same name, both sides — cached and coalesced.',
    },
    {
        name: 'Cache verbs & probes',
        path: '/caching',
        blurb: 'invalidate / refresh, pending / peek / error / watch, reachable.',
    },
    {
        name: 'Reactivity',
        path: '/templating/reactivity',
        blurb: 'state + state.computed + state.linked drive fine-grained DOM updates.',
    },
    {
        name: 'Bindings & directives',
        path: '/templating/bindings',
        blurb: 'bind:value/checked/group, class:/style:, spread, node refs.',
    },
    {
        name: 'Control flow',
        path: '/templating/conditionals',
        blurb: '{#if}, {#for}, {#await}, {#switch}, {#try}, inline components.',
    },
    {
        name: 'File-based routing',
        path: '/pages/routing',
        blurb: 'Pages are files; folders are URLs; [name] captures params.',
    },
    {
        name: 'Sockets',
        path: '/sockets',
        blurb: 'Isomorphic AsyncIterable subscribe + publish over a WS mux.',
    },
    {
        name: 'Platform & scope',
        path: '/platform',
        blurb: 'identity, cookies, context, env, log, trace, health.',
    },
    {
        name: 'Machine surfaces',
        path: '/platform/machines',
        blurb: 'The same RPCs are OpenAPI operations and MCP tools.',
    },
])
// #enddemo
