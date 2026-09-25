/**
 * A single-lane queue: every call waits for the previous one. It is needed wherever concurrent
 * runs race for one resource — for state.json (store) and for the one process of the service
 * session (serviceAgent).
 *
 * A task that failed must not jam the tail, so the queue carries on after a rejection; the error
 * itself goes to its own caller and nobody else.
 */
export function serialize(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve()
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task, task)
    tail = run.catch(() => undefined)
    return run
  }
}
