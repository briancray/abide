import { GET } from 'abide/server/GET'

export interface Capability {
    name: string
    path: string
    blurb: string
}

// Zero-arg read RPC: the capability index that powers the home page and the machine surface. Cached
// and coalesced by the cell like any read; reachable over HTTP at /rpc/capabilities, OpenAPI, and MCP.
// #demo capabilities
export default GET((): Capability[] => [
    {
        name: 'Isomorphic RPC',
        path: '/rpc',
        blurb: 'One callable, same name, both sides — cached and coalesced.',
    },
    {
        name: 'Cache verbs & probes',
        path: '/cache',
        blurb: 'invalidate / refresh, pending / peek / error / watch, reachable.',
    },
    {
        name: 'Reactivity',
        path: '/reactivity',
        blurb: 'state + state.computed + state.linked drive fine-grained DOM updates.',
    },
    {
        name: 'Bindings & directives',
        path: '/bindings',
        blurb: 'bind:value/checked/group, class:/style:, spread, node refs.',
    },
    {
        name: 'Control flow',
        path: '/control',
        blurb: '{#if}, {#for}, {#await}, {#switch}, {#try}, snippets, components.',
    },
    {
        name: 'File-based routing',
        path: '/routing',
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
        path: '/machines',
        blurb: 'The same RPCs are OpenAPI operations and MCP tools.',
    },
])
// #enddemo
