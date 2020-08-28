import { readableStreamFrom } from './readableStreamFrom'
import { TransformObjectStream, TOSOptions } from './TransformObjectStream'

/** Promisify object transformation into an async iterable. */
export function transformIterable<I = any, O = any> (iterable: Iterable<I>, options: TOSOptions): AsyncIterable<O> {
  const input = readableStreamFrom(iterable)
  const output = input.pipeThrough(new TransformObjectStream<I, O>(options))
  const reader = output.getReader()
  const pump = async function * pump (): AsyncIterable<O> {
    const result = await reader.read()

    return {
      ...result,
      next: pump
    }
  }

  return pump()
}

/** Promisify the entire object transformation flow. */
export async function transformObjects<I = any, O = any> (
  iterable: Iterable<I>,
  options: TOSOptions
): Promise<Iterable<O>> {
  const results: O[] = []

  for await (const result of transformIterable<I, O>(iterable, options)) {
    results.push(result)
  }

  return results
}
