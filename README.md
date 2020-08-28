# transform-object-stream

A pure TypeScript/JavaScript library for streaming objects using Web API Streams. Includes primitive support for piping to NodeJS Streams.

## Usage

Install it from the [npm repository](https://www.npmjs.com/package/transform-object-stream):

```console
npm install --save transform-object-stream
```

Then require it in your project:

```js
// Simple example of convenience function. See tests and api for more advanced functionality.
const { transformObjects } = require('transform-object-stream')

async function main () {
  const results = await transformObjects(objects, { rootName: 'root' })
}
```

Package also exports as ES Module with TS definitions for use with Deno and TypeScript.

## API

See the [API documentation](https://ahuggins-nhs.github.io/transform-object-stream/globals.html) for complete information.
