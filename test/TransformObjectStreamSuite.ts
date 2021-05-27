import { FieldMapLike, FieldMapper } from 'field-mapper'
import { TransformObjectStream, OnFold, OnObjectName, transformObjects, readableStreamFrom } from '../src/index'
import { CustomType, Type } from 'strong-typeof'
import { strictEqual, deepStrictEqual, notStrictEqual, throws, doesNotThrow } from 'assert'
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
  if (['duck', 'dog', 'bark', 'cow', 'chicken'].includes(type)) return type

  return name === 'root' ? name : type
}

const fieldMaps: FieldMapLike<any>[] = [
  { fieldName: 'a', propertyName: 'a', objectName: 'object' },
  { fieldName: 'another', propertyName: 'property1', objectName: 'root' },
  { fieldName: 'array', propertyName: 'property2', objectName: 'root' },
  { fieldName: 'message', propertyName: 'property3', objectName: 'duck' },
  { fieldName: 'bark', propertyName: 'property4', objectName: 'dog' },
  { fieldName: 'woof', propertyName: 'property5', objectName: 'bark' },
  { fieldName: 'chews', propertyName: 'property6', objectName: 'cow' },
  { fieldName: 'child', propertyName: 'property7', objectName: 'root' },
  { fieldName: 'child.type', propertyName: 'property8', objectName: 'root' },
  { fieldName: 'flap.like', propertyName: 'property9.property10.property11', objectName: 'chicken' },
  { fieldName: 'flap.like.b', propertyName: 'property9.property10.property12', objectName: 'chicken' },
  { fieldName: 'flap.like.c', propertyName: 'property9.property13', objectName: 'chicken' },
  { fieldName: 'child.maturity', propertyName: 'property14', objectName: 'root' }
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
      },
      {
        type: 'chicken',
        flap: {
          like: {
            a: 'hen',
            b: ['rooster'],
            c: 'chick'
          }
        }
      }
    ]
  ],
  child: {
    type: 'cow',
    chews: 'grass',
    maturity: null as any
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
      },
      {
        property9: {
          property10: {
            property11: {
              a: 'hen'
            },
            property12: ['rooster']
          },
          property13: 'chick'
        }
      }
    ]
  ],
  property7: {
    property6: 'grass'
  },
  property8: 'cow',
  property14: null as any
}

const customTypes: Array<[Type, CustomType<any>, (val: any) => CustomType<any>]> = [
  ['object', 'duck', (value: any) => value.type === 'duck' ? 'duck' : undefined],
  ['object', 'dog', (value: any) => value.type === 'dog' ? 'dog' : undefined],
  ['object', 'bark', (value: any) => value.woof === 'bow wow' ? 'bark' : undefined],
  ['object', 'cow', (value: any) => value.type === 'cow' ? 'cow' : undefined],
  ['object', 'chicken', (value:any) => value.type === 'chicken' ? 'chicken' : undefined]
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
console.log(results)
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
    ts.once('data', (chunk: any) => {
      strictEqual(typeof chunk, 'object')
    })

    throws(() => {
      const ps2 = new PassThrough({ objectMode: true })

      ts.pipe(ps2)
    })

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

  it('should attempt transform with no field map', async () => {
    const results = Array.from(await transformObjects(objects, {
      rootName: 'root',
      onBranch (branch: any[], type: string) {
        return branch
      },
      onEntry (value: any, key: string, type: string) {
        return value
      },
      onLeaf (value: any, index: number, type: string) {
        return value
      },
      onObjectName
    }))

    strictEqual(results.length, objects.length)
  })

  it('should cover remaining scenarios', () => {
    const ts = new TransformObjectStream({ rootName: 'root' })
    const ts2 = new TransformObjectStream({ rootName: 'root' })
    const ps = new PassThrough({ objectMode: true })
    const ps2 = new PassThrough({ objectMode: true })
    const paths = ts as any

    doesNotThrow(() => {
      paths.pathHandler(undefined, undefined)
      paths.pathHandler(undefined, ['one', 'two'])
    })

    doesNotThrow(() => {
      ts.unpipe()
    })

    ts.pipe(ps)

    doesNotThrow(() => {
      ps.emit('error')
    })

    ts2.pipe(ps2)

    doesNotThrow(() => {
      ps2.emit('close')
    })
  })
})
