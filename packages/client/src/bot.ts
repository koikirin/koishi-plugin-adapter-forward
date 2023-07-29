import { Context, Schema, Bot, Awaitable, defineProperty, Session } from '@satorijs/satori'
import { WsClient } from './ws'
import type { Packets } from '@hieuzest/adapter-forward'

interface Internal {
  _request: <P extends Packets>(packet: P) => Awaitable<void>
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
      }
    }

    hookInnerBot()
    ctx.on('bot-added', () => hookInnerBot())

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
    platform: Schema.string(),
    selfId: Schema.string().required(),
    token: Schema.string().role('secret'),
    protocol: Schema.const('ws').default('ws'),
    avoidLoopback: Schema.boolean().default(true),
  })

  export type Config = BaseConfig & WsClient.Config
  
  export const Config: Schema<Config> = Schema.intersect([
    BaseConfig,
    WsClient.Config,
  ])
  
}

ForwardClient.prototype.platform = 'forward'
