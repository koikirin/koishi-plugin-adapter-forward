import { } from 'koishi'
import { Context, Schema, Bot, Awaitable, defineProperty, Session, Logger } from '@satorijs/satori'
import { WsClient } from './ws'
import { Packets, getInternalMethodKeys } from '@hieuzest/adapter-forward'

const logger = new Logger('forward-client')

interface Internal {
  _request: <P extends Packets>(packet: P) => Awaitable<void>
  _methods: string[]
  _update: () => Promise<void>
}

const kForward = Symbol.for('adapter-forward')
const kDispath = Symbol('dispatch')

export class ForwardClient<T extends ForwardClient.Config = ForwardClient.Config> extends Bot<T> {
  internal: Internal
  innerSid: string
  getInnerBot: () => Bot

  constructor(ctx: Context, config: T) {
    super(ctx, config)

    this.innerSid = `${config.platform}:${config.selfId}`
    this.internal = Object.create({})
    defineProperty(this.internal, '_update', () => {
      const bot = findInnerBot()
      if (!this.internal._request) return
      this.internal._request({
        type: 'meta::status',
        payload: {
          status: bot?.status || 'unavailable',
          internalMethods: this.internal._methods
        }
      })
    })

    this.platform = 'forward'
    this.selfId = `${this.config.platform}:${this.config.selfId}`
    this.hidden = true

    const findInnerBot = () => ctx.bots.find(bot => !bot[kForward] && bot.sid === this.innerSid)

    defineProperty(this, 'getInnerBot', config.avoidLoopback ? findInnerBot : () => ctx.bots[this.innerSid])

    if (config.protocol === 'ws') {
      ctx.plugin(WsClient, this)
    }

    const hookInnerBot = () => {
      const bot = findInnerBot()
      if (bot && !bot[kDispath]) {
        const original = bot.dispatch.bind(bot)
        bot.dispatch = (session) => {
          this.dispatchInner(session)
          original(session)
        }
        defineProperty(bot, kDispath, original)

        if (config.loadInternalMethods) {
          getInternalMethodKeys({
            filePath: ctx.loader.cache[ctx.loader.keyFor(bot.ctx.runtime.plugin)]
          }).then(methods => {
            if (methods && methods.length) this.internal._methods = methods
            else delete this.internal._methods
            this.internal._update()
          }).catch(e => logger.warn('failed to load internalMethods', e))
        }
      }
    }

    hookInnerBot()

    ctx.on('bot-added', (botArg) => {
      hookInnerBot()
      const bot = findInnerBot()
      if (bot === botArg) this.internal._update()
    })

    ctx.on('bot-removed', (bot) => {
      if (!bot[kForward] && bot.sid === this.innerSid) {
        this.internal._methods = []
        this.internal._update()
      }
    })

    ctx.on('bot-status-updated', (botArg) => {
      const bot = findInnerBot()
      if (bot === botArg) this.internal._update()
    })

    ctx.on('dispose', () => {
      const bot = findInnerBot()
      if (bot && bot[kDispath]) {
        bot.dispatch = bot[kDispath]
        defineProperty(bot, kDispath, null)
      }
    })
  }

  dispatchInner(session: Session) {
    if (!this.internal._request) return
    if (session.sid === this.innerSid && !session[kForward])
      this.internal?._request({
        type: 'meta::event',
        payload: {
          event: session.type,
          session: session,
          payload: session[session.platform],
        }
      })
  }
}

export namespace ForwardClient {
  export interface BaseConfig extends Bot.Config {
    platform: string
    selfId: string
    token?: string
    avoidLoopback: boolean
  }

  export const BaseConfig: Schema<BaseConfig> = Schema.object({
    platform: Schema.string().required(),
    selfId: Schema.string().required(),
    token: Schema.string().role('secret'),
    protocol: Schema.const('ws').default('ws'),
    avoidLoopback: Schema.boolean().default(true),
  })

  export interface AdvancedConfig {
    loadInternalMethods: boolean
  }

  export const AdvancedConfig: Schema<AdvancedConfig> = Schema.object({
    loadInternalMethods: Schema.boolean().description('Requires typescript as dependency').default(false),
  }).description('高级设置')

  export type Config = BaseConfig & AdvancedConfig & WsClient.Config

  export const Config: Schema<Config> = Schema.intersect([
    BaseConfig,
    AdvancedConfig,
    WsClient.Config,
  ])
}

ForwardClient.prototype.platform = 'forward'
