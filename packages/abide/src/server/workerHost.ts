// 55.1 — THE THREAD A WORKER FILE RUNS IN ON A SERVER STARTED FROM ITS SOURCES: its stand-ins post the
// file's path first, and every call after it. Bun hands a thread none of the runtime's plugins, so
// the file loads here as written, and a worker file it imports is that module too (55.10).
import { serveWorker } from '#shared/worker/serveWorker.ts'

self.onmessage = ({ data }: MessageEvent<string>) => serveWorker(import(data))
