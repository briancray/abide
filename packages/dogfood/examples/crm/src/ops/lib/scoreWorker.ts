// Runs in its own thread: scores each deal it is sent, one message per deal.
self.onmessage = ({
    data: deals,
}: MessageEvent<{ name: string; amount: number }[]>) => {
    for (const deal of deals) {
        let score = 0
        for (let round = 0; round < 5_000_000; round += 1)
            score = (score * 31 + deal.amount + round) % 100
        postMessage({ name: deal.name, score })
    }
    postMessage(null)
}
