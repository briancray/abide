import { GET } from 'abide/server/GET'

// A read RPC that echoes its single object argument back with a derived length — enough to show a
// live in-proc read landing its value directly in the SSR'd HTML.
export default GET(({ message = 'hello' }: { message?: string }) => ({
    echoed: message,
    length: message.length,
}))
