import { ReadableStream } from 'web-streams-polyfill/ponyfill/es2018'

/** Create a Web API readable stream from an iterable. */
export function readableStreamFrom<T> (iterable: Iterable<T>) {
  return new ReadableStream<T>({
    start (controller) {
      for (const item of iterable) {
        controller.enqueue(item)
      }

      controller.close()
    }
  })
}
