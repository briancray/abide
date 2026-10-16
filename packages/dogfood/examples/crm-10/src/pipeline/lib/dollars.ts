/** An amount in whole dollars, as the pipeline shows it. */
export function dollars(amount: number): string {
    return `$${amount.toLocaleString('en-US')}`
}
