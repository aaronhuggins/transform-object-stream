import { FieldMapLike } from 'field-mapper'
import { TransformObjectStream, OnFold, OnObjectName, transformObjects, readableStreamFrom } from '../src/index'
import { CustomType, Type } from 'strong-typeof'
import { strictEqual, deepStrictEqual, notStrictEqual } from 'assert'

const skipProps = ['prop', 'type']

const onFold: OnFold = function (object: any, key: string, type: string) {
  if (type === 'bark') {
    return object
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
  { fieldName: 'obj', propertyName: 'property7', objectName: 'root' }
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
  obj: {
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

describe('TransformObjectStream', () => {
  it ('should transform an object stream', async () => {
    const objects = [testObject, testObject, testObject]
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
})
