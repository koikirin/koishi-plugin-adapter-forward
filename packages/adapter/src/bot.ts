import { Context, Logger, Bot, defineProperty, Awaitable, Universal } from '@satorijs/satori'
import { WebSocket } from 'ws'
import { UpPacketsMap, universalMethods, predefinedUniversalMethods } from '@hieuzest/adapter-forward'
import { prepareUniversalMethods } from './utils'
import { kForward, kUniversalMethods, kInternalMethods } from '.'

const logger = new Logger('forward')

interface Internal {
  _send: <T extends keyof UpPacketsMap>(type: T, payload: UpPacketsMap[T]['payload'], rest?: Partial<UpPacketsMap[T]>, socket?: WebSocket) => Awaitable<void>
  _call: <T extends keyof UpPacketsMap>(type: T, payload: UpPacketsMap[T]['payload'], rest?: Partial<UpPacketsMap[T]>, socket?: WebSocket) => Awaitable<any>
  _update: (bot: Bot, socket?: WebSocket) => Promise<void>
}

export interface ForwardBot {
  [kUniversalMethods]?: (keyof Universal.Methods)[]
  [kInternalMethods]?: string[]
}

export class ForwardBot<T extends ForwardBot.Config = ForwardBot.Config> extends Bot<T> {
  internal: Internal
  [kForward] = true

  constructor(ctx: Context, config: T) {
    super(ctx, config)
    ForwardBot.prototype.platform = config.platform
    this.selfId = config.selfId
    this[kUniversalMethods] = config.universalMethods
    this[kInternalMethods] = config.internalMethods

    this.internal = new Proxy({} as Internal, {
      set(target, p, newValue, receiver) {
        return Reflect.set(target, p, newValue, receiver)
      },
      get(target, p, receiver) {
        if (Reflect.has(target, p)) return Reflect.get(target, p, receiver)
        if (typeof p === 'symbol') return null
        if (!Reflect.has(target, '_request')) {
          logger.error('Bot not connected')
          return
        }
        if (this[kInternalMethods]?.includes(p)) {
          return (...args: any[]) => target._call('action::internal', {
            action: p,
            args,
          })
        }
      },
    })

    this._updateUniversalMethods()

    if (config.callback) {
      config.callback(this)
      delete config.callback
    }
  }

  async initialize() {
    if (!this.getSelf) return
    await this.getSelf().then(data => Object.assign(this, data))
  }

  _updateUniversalMethods() {
    for (const method of universalMethods) {
      try {
        if (!predefinedUniversalMethods.includes(method)
          && (!!this[method] === !!(!this[kUniversalMethods] || this[kUniversalMethods]?.includes(method)))) continue
        if (!this[kUniversalMethods] || this[kUniversalMethods]?.includes(method)) {
          this[method] = async (...args: any) => {
            if (!this.internal._send) {
              logger.error('Bot not connected')
              return
            }
            return await this.internal._call('action::bot', {
              action: method,
              args: await prepareUniversalMethods(this, method, args),
            })
          }
        } else {
          delete this[method]
        }
      } catch (e) {
        logger.warn('Hooking %s %s failed', this.sid, method)
      }
    }
  }
}

export namespace ForwardBot {
  export interface Config extends Bot.Config {
    callback: (bot: ForwardBot) => Awaitable<void>
    universalMethods?: (keyof Universal.Methods)[]
    internalMethods?: string[]
  }
}

ForwardBot.prototype[kForward] = true

export default ForwardBot
