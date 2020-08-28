import { FieldMapLike, FieldMapper } from 'field-mapper'
import { TransformObjectStream, OnFold, OnObjectName, transformObjects, readableStreamFrom } from '../src/index'
import { CustomType, Type } from 'strong-typeof'
import { strictEqual, deepStrictEqual, notStrictEqual } from 'assert'
import { PassThrough } from 'stream'

const skipProps = ['prop', 'type']

const onFold: OnFold = function (object: any, key: string, type: string) {
  if (type === 'bark') {
    return {
      __fold__: true,
      value: object
    }
  }

  return false
}

const onObjectName: OnObjectName = function (name: string, type: string, value: any) {
  if (['duck', 'dog', 'bark', 'cow'].includes(type)) return type

  return name
}

const fieldMaps: FieldMapLike<any>[] = [
  { fieldName: 'another', propertyName: 'property1', objectName: 'root' },
  { fieldName: 'array', propertyName: 'property2', objectName: 'root' },
  { fieldName: 'message', propertyName: 'property3', objectName: 'duck' },
  { fieldName: 'bark', propertyName: 'property4', objectName: 'dog' },
  { fieldName: 'woof', propertyName: 'property5', objectName: 'bark' },
  { fieldName: 'chews', propertyName: 'property6', objectName: 'cow' },
  { fieldName: 'child', propertyName: 'property7', objectName: 'root' }
]

const testObject = {
  prop: 'skip me',
  another: 'wont skip',
  array: [
    'hello',
    {
      type: 'duck',
      message: 'walks like one'
    },
    [
      12,
      [
        Symbol.iterator
      ],
      {
        type: 'dog',
        bark: {
          prop: 'skip me, too',
          woof: 'bow wow'
        }
      }
    ]
  ],
  child: {
    type: 'cow',
    chews: 'grass'
  }
}

const resultObject = {
  property1: 'wont skip',
  property2: [
    'hello',
    {
      property3: 'walks like one'
    },
    [
      12,
      [
        Symbol.iterator
      ],
      {
        property5: 'bow wow'
      }
    ]
  ],
  property7: {
    property6: 'grass'
  }
}

const customTypes: Array<[Type, CustomType<any>, (val: any) => CustomType<any>]> = [
  ['object', 'duck', (value: any) => value.type === 'duck' ? 'duck' : undefined],
  ['object', 'dog', (value: any) => value.type === 'dog' ? 'dog' : undefined],
  ['object', 'bark', (value: any) => value.woof === 'bow wow' ? 'bark' : undefined],
  ['object', 'cow', (value: any) => value.type === 'cow' ? 'cow' : undefined]
]

for (const [rootType, customType, typeCheck] of customTypes) {
  TransformObjectStream.registerCustomType(rootType, customType, typeCheck)
}

const objects = [testObject, testObject, testObject]

describe('TransformObjectStream', () => {
  it ('should transform an object stream', async () => {
    const results = Array.from(await transformObjects(objects, {
      rootName: 'root',
      skipProps,
      onFold,
      onObjectName,
      fieldMaps
    }))

    strictEqual(results.length, objects.length)

    // This indicates that each passed object is the same pointer in memory
    strictEqual(objects[0], objects[1])
    // This indicates that each result is a distinct copy in memory
    notStrictEqual(results[0], results[1])

    // Results should be equal deeply, but not strictly
    deepStrictEqual(results[0], resultObject)
    deepStrictEqual(results[1], resultObject)
    deepStrictEqual(results[2], resultObject)

    notStrictEqual(results[0], resultObject)
    notStrictEqual(results[1], resultObject)
    notStrictEqual(results[2], resultObject)
  })

  it('should pipe output to nodejs stream', async () => {
    const rs = readableStreamFrom(objects)
    const ts = new TransformObjectStream({ rootName: 'root', fieldMapper: new FieldMapper(fieldMaps) })
    const ps = new PassThrough({ objectMode: true })
    
    ts.pipe(ps)
    rs.pipeThrough(ts)

    const results = await new Promise<any[]>((resolve, reject) => {
      const chunks: any[] = []

      ps.on('data', (chunk: any) => {
        chunks.push(chunk)
      })
      ps.on('end', () => resolve(chunks))
      ps.on('error', (error: any) => reject(error))
    })

    strictEqual(results.length, objects.length)
  })
})
