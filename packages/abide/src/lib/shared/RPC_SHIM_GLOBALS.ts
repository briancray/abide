/*
The reserved global alias names the `$rpc`/`$socket` module rewrites target: the bundler's
banner binds each (`import { defineRpc as __abideDefineRpc__ }`, see abideResolverPlugin) and
the codegen emit (`prepareRpcModule` / `prepareSocketModule`) calls it. Shared so the emitted
call and the banner binding can't drift into an unbound-name ReferenceError at load.
*/
export const DEFINE_RPC_GLOBAL = '__abideDefineRpc__'
export const REMOTE_PROXY_GLOBAL = '__abideRemoteProxy__'
export const DEFINE_SOCKET_GLOBAL = '__abideDefineSocket__'
