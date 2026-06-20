/*
Internal response-header marker the streaming SSR renderer stamps on its
progressively-flushed `text/html` document. `gzipResponse` reads it to pick a
per-chunk-flushing gzip over the buffering web CompressionStream (then strips it
before send): a plain CompressionStream holds the head until its deflate window
flushes, defeating progressive delivery — the browser can't preload-scan the head
or paint the pending shell until the stream nearly closes. A streamed `text/html`
body is otherwise indistinguishable from a buffered one (both expose a
ReadableStream), and `isStreamingResponse` can't be widened to cover it without
also opting these pages out of the idle-timeout cap they rely on (see
disableIdleTimeoutForStream).
*/
export const STREAMED_HTML_HEADER = 'abide-streamed-html'
