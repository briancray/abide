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
        name: 'state — the owned value',
        path: '/state',
        blurb: 'Isomorphic writable cell, callable, shareable by key across tabs.',
    },
    {
        name: 'memo — the loaded value',
        path: '/memo',
        blurb: 'One memoizer for everything derived; deps are its declared inputs.',
    },
    {
        name: 'channel — the pushed value',
        path: '/channel',
        blurb: 'In-process pub/sub keyed by room — what a socket puts on the wire.',
    },
    {
        name: 'watch — the effect',
        path: '/watch',
        blurb: 'Change-only and auto-tracked effects; fires on the server too.',
    },
    {
        name: 'rpc = memo + transport',
        path: '/rpc',
        blurb: 'One callable, same name, both sides — cached and coalesced.',
    },
    {
        name: 'Surface verbs & probes',
        path: '/memo/verbs',
        blurb: 'invalidate / refresh / publish, peek / pending / error / watch.',
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
        name: 'socket = channel + transport',
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
