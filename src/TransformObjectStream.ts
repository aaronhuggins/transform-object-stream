import { TransformStream } from 'web-streams-polyfill/ponyfill/es2018'
import { FieldMapper, FieldMapLike } from 'field-mapper'
import { typeOf, isType } from 'strong-typeof'

type OnObjectName = (name: string, type: string, value: any) => string
type OnBranch = (branch: any[], type: string) => any[]
type OnEntry = (value: any, key: string, type: string) => any
type OnFold = (object: any, key: string, type: string) => Record<string | number | symbol, any> | false
type OnLeaf = (value: any, index: number, type: string) => any

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

export class TransformObjectStream<I = any, O = any> extends TransformStream<I, O> {
  constructor (options: TOSOptions) {
    let self: this

    super({
      transform (chunk: I, controller: TransformStreamDefaultController<O>) {
        if (isType(chunk, 'null')) {
          controller.terminate()
          self.emit('end')
        } else {
          const transformed = self.transform(chunk, options.rootName)
          controller.enqueue(transformed)
          self.emit('data', transformed)
        }
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

    if (typeof options.onBranch === 'function') this.on('branch', options.onBranch)
    if (typeof options.onEntry === 'function') this.on('entry', options.onEntry)
    if (typeof options.onFold === 'function') this.on('fold', options.onFold)
    if (typeof options.onLeaf === 'function') this.on('leaf', options.onLeaf)
    if (typeof options.onObjectName === 'function') this.on('object_name', options.onObjectName)

    this._readableState = {
      pipesCount: 0
    }
  }

  private events: Record<string, Function[]>
  private fieldMapper: FieldMapper<any>
  private skipProps: string[]
  private _readableState: {
    pipesCount: number
    pipes?: any & { pipe: Function } | any[]
  }

  transform (object: I, name: string): O {
    const self = this
    const result = Object.create(null)
    const objectMap = this.fieldMapper.getObjectMap(name)

    for (const [key, value] of Object.entries(object || Object.create(null)) as Array<[string, any]>) {
      // If propertyName is undefined, fall back to current key
      const { propertyName = key } = objectMap.getFieldMap(key)

      if (this.skipProps.includes(propertyName)) continue

      const type = typeOf(value)
      const entry = this.emitValue('entry', value, key, type)

      if (Array.isArray(entry)) {
        const mapFunc = function mapFunc (item: any, index: number): any {
          const leafType = typeOf(item)
          const leaf = this.emitValue('leaf', item, index, leafType)

          if (Array.isArray(leaf)) {
            const branch = this.emitValue('branch', leaf, leafType)

            return branch.map(mapFunc)
          }

          if (typeof leaf === 'object') {
            const objectName = self.emitValue('object_name', name, leafType, leaf)

            return self.transform(leaf, objectName)
          }

          return leaf
        }
        const branch = this.emitValue('branch', entry, type)

        result[propertyName] = branch.map(mapFunc)
        continue
      }

      if (typeof entry === 'object') {
        const objectName = self.emitValue('object_name', name, type, entry)
        const transformed = self.transform(entry, objectName)
        const fold = self.emitValue('fold', transformed, propertyName, type)

        if (fold) {
          for (const [foldKey, foldValue] of Object.entries(fold)) {
            result[foldKey] = foldValue
          }
          continue
        }

        result[propertyName] = transformed
        continue
      }

      result[propertyName] = entry
    }
  
    return result
  }

  on (mutate: 'object_name', mutator: OnObjectName): void
  on (mutate: 'branch', mutator: OnBranch): void
  on (mutate: 'leaf', mutator: OnLeaf): void
  on (mutate: 'entry', mutator: OnEntry): void
  on (mutate: 'fold', mutator: OnFold): void
  on (event: 'end', listener: VoidFunction): void
  on (event: 'data', listener: (chunk: any) => void): void
  on (event: string, listener: Function): void {
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
  removeListener (event: 'data', listener: (chunk: any) => void): void
  removeListener (event: string, listener: Function): void {
    if (typeof this.events[event] === 'object') {
      const index = this.events[event].indexOf(listener)

      if (index > -1) this.events[event].splice(index, 1)
    }
  }

  emit (event: string, ...args: any[]): void {
    if (typeof this.events[event] === 'object') {
      for (const listener of this.events[event]) {
        listener.call(this, ...args)
      }
    }
  }

  emitValue (mutate: 'object_name', name: string, type: string, item: any): string
  emitValue (mutate: 'branch', branch: any[], type: string): any[]
  emitValue (mutate: 'leaf', value: any, index: number, type: string): any
  emitValue (mutate: 'entry', value: any, key: string, type: string): any
  emitValue (mutate: 'fold', object: any, key: string, type: string): Record<string | number | symbol, any> | false
  emitValue (mutate: string, value: any, ...args: any[]): any {
    let result = value

    if (typeof this.events[mutate] === 'object') {
      for (const listener of this.events[mutate]) {
        result = listener.call(this, result, ...args)
      }
    }

    return result
  }

  once (mutate: 'object_name', mutator: OnObjectName): void
  once (mutate: 'branch', mutator: OnBranch): void
  once (mutate: 'leaf', mutator: OnLeaf): void
  once (mutate: 'entry', mutator: OnEntry): void
  once (mutate: 'fold', mutator: OnFold): void
  once (event: string, listener: Function): void {
    const listenOnce = function listenOnce (...args: any[]) {
      this.removeListener(event, listenOnce)

      return listener.call(this, ...args)
    }

    this.on(event as any, listenOnce)
  }

  /** Pipe to a NodeJS stream. Highly primitive support; will not manage data flow
   *  and will always close the pipes.
   */
  pipe (destination: any & { pipe: Function }, options: any) {
    let src = this
    let state = this._readableState
  
    switch (state.pipesCount) {
      case 0:
        state.pipes = destination
        break
      case 1:
        state.pipes = [state.pipes, destination]
        break
      default:
        state.pipes.push(destination)
        break
    }

    state.pipesCount += 1

    function unpipe () {
      if (state.pipesCount === 0) return

      const pipes: any[] = state.pipesCount === 1 ? [state.pipes] : state.pipes

      for (const dest of pipes) {
        dest.emit('unpipe', src, { hasUnpiped: false })
      }
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

    src.on('end', onend)
  
    function cleanup () {
      destination.removeListener('close', onclose)
      destination.removeListener('finish', onfinish)
      destination.removeListener('error', onerror)
      destination.removeListener('unpipe', onunpipe)
      src.removeListener('end', onend)
      src.removeListener('end', unpipe)
      src.removeListener('data', ondata)
    }
  
    function ondata (chunk: any) {
      destination.write(chunk)
    }

    src.on('data', ondata)

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

    src.on('end', unpipe)

    destination.emit('pipe', src)

    return destination
  }
}
