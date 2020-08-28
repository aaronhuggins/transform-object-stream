import { readableStreamFrom } from './readableStreamFrom'
import { TransformObjectStream, TOSOptions } from './TransformObjectStream'

/** Promisify the entire object transformation flow. */
export async function transformObjects<I = any, O = any> (iterable: Iterable<I>, options: TOSOptions): Promise<Iterable<O>> {
  const results: O[] = []
  const input = readableStreamFrom(iterable)
  const output = input.pipeThrough(new TransformObjectStream<I, O>(options))
  const reader = output.getReader()
  const pump = async function pump (): Promise<O[]> {
    const result = await reader.read()

    if (result.done) {
      return results
    } else {
      results.push(result.value)
    }

    return await pump()
  }

  return await pump()
}
