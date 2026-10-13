// Runs the command it is handed for as long as its own stdin is open, and kills it when that closes.
//
// A SERVER A TEST PROCESS STARTS FOR ITS WHOLE LIFE outlives it otherwise: `bun test` fires neither
// `exit` nor `beforeExit`, so a stop hooked there never runs, and every run left one `abide start`
// serving. The pipe is closed by the OS however the test process ends, so the server ends with it —
// and a signal to this process's group ends it too: under `--parallel` the wrapper alone was
// signaled away, three servers a run outlived it, and none does with the handlers below.

const served = Bun.spawn(process.argv.slice(2), {
    stdout: 'inherit',
    stderr: 'inherit',
})
void served.exited.then((code) => process.exit(code))
const end = (): never => {
    served.kill('SIGKILL')
    process.exit(0)
}
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const)
    process.on(signal, end)
void Bun.stdin.stream().pipeTo(new WritableStream()).then(end)
