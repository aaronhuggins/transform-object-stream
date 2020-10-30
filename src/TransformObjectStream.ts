import { TransformStream } from 'web-streams-polyfill/ponyfill/es2018'
import { FieldMapper, FieldMapLike } from 'field-mapper'
import { typeOf, isType, addCustomType, Type } from 'strong-typeof'

export type TransformObjectEvents = 'object_name' | 'branch' | 'leaf' | 'entry' | 'fold' | 'end' | 'data'

export const EVENTS: {
  object_name: 'object_name'
  branch: 'branch'
  leaf: 'leaf'
  entry: 'entry'
  fold: 'fold'
  end: 'end'
  data: 'data'
} = {
  /** Object naming event. Occurs before passing a child/leaf object to be transformed. */
  object_name: 'object_name',
  /** Array visitied in the object tree. Occurs for every array visited in the object tree and branches. */
  branch: 'branch',
  /** Value visited on a branch. Occurs for each item in an array and before passing a leaf object to be transformed. */
  leaf: 'leaf',
  /** Entry visited on an object. Occurs after the property name has been looked up but before any other event. */
  entry: 'entry',
  /** Object folding event. Occurs after passing a child object to be transformed, if the child is not a leaf. */
  fold: 'fold',
  /** Signals to NodeJS Stream that the stream has ended. */
  end: 'end',
  /** Signals to NodeJS Stream that there is a chunk of data. */
  data: 'data'
}

Object.freeze(EVENTS)
Object.seal(EVENTS)

/** @hidden */
const fakeObjectMap = { getFieldMap: () => {} }

export type OnFoldOutput = { __fold__: true, value: Record<string | number | symbol, any> } | { __fold__: false } | false
export type OnObjectName = (name: string, type: string, value: any) => string
export type OnBranch = (branch: any[], type: string) => any[]
export type OnEntry = (value: any, key: string, type: string) => any
export type OnFold = (object: any, key: string, type: string) => OnFoldOutput
export type OnLeaf = (value: any, index: number, type: string) => any

export interface TOSOptions {
  rootName: string
  fieldMaps?: FieldMapLike<any>[]
  fieldMapper?: FieldMapper<any>
  skipProps?: string[]
  onBranch?: OnBranch
  onEntry?: OnEntry
  onFold?: OnFold
  onLeaf?: OnLeaf
  onObjectName?: OnObjectName
}

/** Class for transforming objects from one kind to another. */
export class TransformObjectStream<I = any, O = any> extends TransformStream<I, O> {
  constructor (options: TOSOptions) {
    let self: this

    super({
      start() {},
      transform (chunk: I, controller: TransformStreamDefaultController<O>) {
        const transformed = self.transform(chunk, options.rootName)

        controller.enqueue(transformed)
        self.emit(EVENTS.data, transformed)
      },
      flush () {
        self.emit(EVENTS.end)
      }
    })

    self = this

    this.events = Object.create(null)

    if (Array.isArray(options.fieldMaps)) {
      this.fieldMapper = new FieldMapper(options.fieldMaps)
    } else if (typeof options.fieldMapper === 'object') {
      this.fieldMapper = options.fieldMapper
    } else {
      this.fieldMapper = new FieldMapper()
    }

    if (Array.isArray(options.skipProps)) {
      this.skipProps = options.skipProps
    } else {
      this.skipProps = []
    }

    this.options = { ...options }

    if (typeof options.onBranch === 'function') this.on(EVENTS.branch, options.onBranch)
    if (typeof options.onEntry === 'function') this.on(EVENTS.entry, options.onEntry)
    if (typeof options.onFold === 'function') this.on(EVENTS.fold, options.onFold)
    if (typeof options.onLeaf === 'function') this.on(EVENTS.leaf, options.onLeaf)
    if (typeof options.onObjectName === 'function') {
      this.on(EVENTS.object_name, options.onObjectName)
    } else {
      // By default, return the root name or type string for the object name.
      this.on(EVENTS.object_name, (name: string, type: string, value: any) => {
        return this.defaultOnObjectName(name, type, value)
      })
    }

    this._readableState = {
      pipesCount: 0
    }
  }

  private events: Record<string, Function[]>
  private fieldMapper: FieldMapper<any>
  private options: TOSOptions
  private skipProps: string[]
  private _readableState: {
    pipesCount: number
    pipes?: (any & { pipe: Function }) | any[]
    reader?: ReadableStreamDefaultReader<O>
  }

  /** Register a custom type to be used when crawling an object tree. */
  static registerCustomType<T = string, P = any> (rootType: Type, customType: T, typeCheck: (value: P) => T) {
    addCustomType(rootType, customType, typeCheck)
  }

  private transform (object: I, name: string): O {
    const self = this
    const result: any = {}
    const objectMap = this.fieldMapper.getObjectMap(name) || fakeObjectMap
    const transformer = (fieldName: string, propertyName: string, value: any) => {
      if (typeof propertyName === 'undefined' || this.skipProps.includes(propertyName)) return

      const type = typeOf(value)
      const entry = this.emitMutation(EVENTS.entry, value, fieldName, type)
      const isPath = propertyName.includes('.')
      const setPathValue = (value: any) => {
        if (isPath) {
          self.pathHandler(result, propertyName, value)
        }

        return isPath
      }

      if (Array.isArray(entry)) {
        const branch = this.emitMutation(EVENTS.branch, entry, type)
        const transformed = branch.map(self.getMapFunction(name))

        if (setPathValue(transformed)) return

        result[propertyName] = transformed
        return
      }

      if (typeof entry === 'object') {
        const objectName = self.emitMutation(EVENTS.object_name, name, type, entry)
        const transformed = self.transform(entry, objectName)
        const fold = self.emitMutation(EVENTS.fold, transformed, propertyName, type)

        if (fold && fold.__fold__) {
          for (const [foldKey, foldValue] of Object.entries(fold.value)) {
            result[foldKey] = foldValue
          }
          return
        }

        if (setPathValue(transformed)) return

        result[propertyName] = transformed
        return
      }

      if (setPathValue(entry)) return

      result[propertyName] = entry
    }

    for (const fieldPath of this.fieldMapper.getFieldPaths(name)) {
      const { propertyName } = objectMap.getFieldMap(fieldPath) || {}
      const value = this.pathHandler(object, fieldPath)

      transformer(fieldPath, propertyName, value)
    }

    for (const [fieldName, value] of Object.entries(object || {}) as Array<[string, any]>) {
      // If propertyName is undefined, fall back to current key
      const { propertyName } = objectMap.getFieldMap(fieldName) || {}

      transformer(fieldName, propertyName, value)
    }

    return result
  }

  private pathHandler (input: Record<string | number, any>, path: string | string[]): any
  private pathHandler (input: Record<string | number, any>, path: string | string[], value: any): void
  private pathHandler (input: Record<string | number, any>, path: string | string[], value?: any): any {
    if (typeof path === 'undefined') return input

    const properties = typeof path === 'string' ? path.split('.') : [].concat(path)
    const lastPlace = properties.length - 1
    const setValue = typeof value !== 'undefined'
    let visitor: any = input

    for (let i = 0; i < properties.length; i += 1) {
      if (i === lastPlace) {
        if (setValue) {
          visitor[properties[i]] = value

          // Return void for setter
          return
        }

        // Return final property for getter
        if (typeof visitor !== 'undefined' && visitor !== null) return visitor[properties[i]]
      }

      if (setValue && typeof visitor[properties[i]] === 'undefined' && i < lastPlace) {
        visitor[properties[i]] = {}
      }

      if (typeof visitor !== 'undefined' && visitor !== null) visitor = visitor[properties[i]]
    }
  }

  private getMapFunction (name: string): (item: any, index: number) => any {
    const self = this

    return function mapFunc (item: any, index: number): any {
      const leafType = typeOf(item)
      const leaf = self.emitMutation(EVENTS.leaf, item, index, leafType)

      if (Array.isArray(leaf)) {
        const branch = self.emitMutation(EVENTS.branch, leaf, leafType)

        return branch.map(self.getMapFunction(name))
      }

      if (typeof leaf === 'object') {

        const objectName = self.emitMutation(EVENTS.object_name, name, leafType, leaf)

        return self.transform(leaf, objectName)
      }

      return leaf
    }
  }

  private defaultOnObjectName (name: string, type: string, value: any): string {
    return name === this.options.rootName ? name : type
  }

  on (mutate: 'object_name', mutator: OnObjectName): void
  on (mutate: 'branch', mutator: OnBranch): void
  on (mutate: 'leaf', mutator: OnLeaf): void
  on (mutate: 'entry', mutator: OnEntry): void
  on (mutate: 'fold', mutator: OnFold): void
  on (event: 'end', listener: VoidFunction): void
  on (event: 'data', listener: (chunk: O) => void): void
  on (event: TransformObjectEvents, listener: Function): void {
    if (typeof this.events[event] !== 'object') {
      this.events[event] = []
    }

    this.events[event].push(listener)
  }

  removeListener (mutate: 'object_name', mutator: OnObjectName): void
  removeListener (mutate: 'branch', mutator: OnBranch): void
  removeListener (mutate: 'leaf', mutator: OnLeaf): void
  removeListener (mutate: 'entry', mutator: OnEntry): void
  removeListener (mutate: 'fold', mutator: OnFold): void
  removeListener (event: 'end', listener: VoidFunction): void
  removeListener (event: 'data', listener: (chunk: O) => void): void
  removeListener (event: TransformObjectEvents, listener: Function): void {
    if (typeof this.events[event] === 'object') {
      const index = this.events[event].indexOf(listener)

      if (index > -1) this.events[event].splice(index, 1)
    }
  }

  emit (event: 'end'): void
  emit (event: 'data', chunk: O): void
  emit (event: TransformObjectEvents, ...args: any[]): void {
    if (typeof this.events[event] === 'object') {
      for (const listener of this.events[event]) {
        listener.call(this, ...args)
      }
    }
  }

  emitMutation (mutate: 'object_name', name: string, type: string, item: any): string
  emitMutation (mutate: 'branch', branch: any[], type: string): any[]
  emitMutation (mutate: 'leaf', value: any, index: number, type: string): any
  emitMutation (mutate: 'entry', value: any, key: string, type: string): any
  emitMutation (mutate: 'fold', object: any, key: string, type: string): OnFoldOutput
  emitMutation (mutate: TransformObjectEvents, value: any, ...args: any[]): any {
    let result = value

    if (typeof this.events[mutate] === 'object') {
      for (const listener of this.events[mutate]) {
        const mutation = listener.call(this, result, ...args)

        if (!isType(mutation, 'null', 'undefined')) result = mutation
      }
    }

    return result
  }

  once (mutate: 'object_name', mutator: OnObjectName): void
  once (mutate: 'branch', mutator: OnBranch): void
  once (mutate: 'leaf', mutator: OnLeaf): void
  once (mutate: 'entry', mutator: OnEntry): void
  once (mutate: 'fold', mutator: OnFold): void
  once (event: 'end', listener: VoidFunction): void
  once (event: 'data', listener: (chunk: O) => void): void
  once (event: TransformObjectEvents, listener: Function): void {
    const listenOnce = function listenOnce (...args: any[]) {
      this.removeListener(event, listenOnce)

      return listener.call(this, ...args)
    }

    this.on(event as any, listenOnce)
  }

  unpipe () {
    let src = this
    let state = this._readableState

    if (state.pipesCount === 0) return

    const pipes: any[] = state.pipesCount === 1 ? [state.pipes] : state.pipes

    for (const dest of pipes) {
      dest.emit('unpipe', src, { hasUnpiped: false })
    }
  }

  /** Pipe to a NodeJS stream. Highly primitive support; will not manage data flow
   * and will always close the pipe. Options are not used in any way. Only one
   * destination is supported; subsequent calls will throw an error and disrupt pipe.
   */
  pipe (destination: any & { pipe: Function }, options?: any) {
    let src = this
    let state = this._readableState

    state.pipes = destination
    state.pipesCount = 1

    function unpipe () {
      src.unpipe()
    }

    function onunpipe (readable: any, unpipeInfo: any) {
      if (readable === src) {
        if (unpipeInfo && unpipeInfo.hasUnpiped === false) {
          unpipeInfo.hasUnpiped = true
          cleanup()
        }
      }
    }

    destination.on('unpipe', onunpipe)

    function onend () {
      destination.end()
    }

    src.on(EVENTS.end, onend)

    function cleanup () {
      destination.removeListener('close', onclose)
      destination.removeListener('finish', onfinish)
      destination.removeListener('error', onerror)
      destination.removeListener('unpipe', onunpipe)
      src.removeListener(EVENTS.end, onend)
      src.removeListener(EVENTS.end, unpipe)
      src.removeListener(EVENTS.data, ondata)
    }

    function ondata (chunk: any) {
      destination.write(chunk)
    }

    src.on(EVENTS.data, ondata)

    function onerror (er: any) {
      unpipe()
      destination.removeListener('error', onerror)
    }

    destination.on('error', onerror)

    function onclose () {
      destination.removeListener('finish', onfinish)
      unpipe()
    }

    destination.once('close', onclose)

    function onfinish () {
      destination.removeListener('close', onclose)
      unpipe()
    }

    destination.once('finish', onfinish)

    src.on(EVENTS.end, unpipe)

    destination.emit('pipe', src)

    if (!state.reader) {
      state.reader = this.readable.getReader()

      const read = function read () {
        state.reader.read().then(result => {
          if (!result.done) {
            read()
          }
        })
      }
  
      read()
    } else {
      throw new Error('Only one pipe permitted in implementation')
    }

    return destination
  }
}
