/** Whether a process `pid` names is running: signal 0 delivered, or refused because it is someone else's (EPERM). */
export function isRunning(pid: number): boolean {
    try {
        process.kill(pid, 0)
        return true
    } catch (thrown) {
        return (thrown as { code?: string | undefined }).code === 'EPERM'
    }
}
