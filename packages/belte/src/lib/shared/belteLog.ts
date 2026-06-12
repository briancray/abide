import { createChannelLog } from './createChannelLog.ts'
import { emitLogRecord } from './emitLogRecord.ts'
import type { ChannelLog } from './types/ChannelLog.ts'
import type { FrameworkLog } from './types/FrameworkLog.ts'

const BELTE_CHANNEL = 'belte'

/*
The framework's own voice: the public log shape bound to the always-on
'belte' channel, so every framework line — boot messages, build output,
internal warns/errors, the closing record's sibling diagnostics — reads
`[belte] …` and json consumers filter channel='belte'. The styling voices
(info/success/detail) ride the same channel and the same negation gate, so
DEBUG=-belte silences every voice; diagnostic sub-channels (belte:cache,
belte:svelte, …) stay DEBUG-gated via .channel().
*/
const channelVoice = createChannelLog(() => BELTE_CHANNEL, true)

export const belteLog: FrameworkLog = Object.assign(channelVoice, {
    channel(name: string): ChannelLog {
        return createChannelLog(() => name, false)
    },
    info(message: string): void {
        if (channelVoice.enabled()) {
            emitLogRecord({ level: 'info', msg: message, channel: BELTE_CHANNEL })
        }
    },
    success(message: string): void {
        if (channelVoice.enabled()) {
            emitLogRecord({ level: 'info', msg: message, channel: BELTE_CHANNEL }, 'success')
        }
    },
    detail(message: string): void {
        if (channelVoice.enabled()) {
            emitLogRecord({ level: 'info', msg: message, channel: BELTE_CHANNEL }, 'detail')
        }
    },
})
