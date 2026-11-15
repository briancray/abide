/** An IndexedDB request as a promise of its result, refused with its error. */
export function requested<Result>(
    request: IDBRequest<Result>,
): Promise<Result> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
    })
}
