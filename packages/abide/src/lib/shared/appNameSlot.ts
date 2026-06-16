/*
The app's name — the default log channel every unchanneled record carries.
Set once per process by createServer (package.json name / appInfo) and once
per page by startClient (the __SSR__ stamp). Undefined until the runtime
boots; readers fall back to 'app' so isolated tests and pre-boot logging
still carry a channel.
*/
export const appNameSlot: { name: string | undefined } = {
    name: undefined,
}
