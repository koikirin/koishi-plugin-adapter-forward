import { Adapter, Context, Logger, Quester, Schema, Time, WebSocketLayer, Bot, Awaitable, defineProperty, Dict, Session } from '@satorijs/satori'
import { WsClient } from './ws'
import type { Packets } from '@hieuzest/adapter-forward'

interface Internal {
  _request: <P extends Packets>(packet: P) => Awaitable<void>
}

const kForward = Symbol.for('adapter-forward')

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

    defineProperty(this, 'getInnerBot', config.testMode
      ? () => ctx.bots.find(b => !b[kForward] && b.sid === this.innerSid)
      : () => ctx.bots[this.innerSid])

    if (config.protocol === 'ws') {
      ctx.plugin(WsClient, this)
    }

    ctx.on('message', (session) => {
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
    }, true)
  }

  // getInnerBot() {
  //   return this.ctx.bots[this.innerSid]
  // }

}

export namespace ForwardClient {
  export interface BaseConfig extends Bot.Config {
    platform: string
    selfId: string
    token?: string
    testMode: boolean
  }

  export const BaseConfig: Schema<BaseConfig> = Schema.object({
    platform: Schema.string(),
    selfId: Schema.string().required(),
    token: Schema.string().role('secret'),
    protocol: Schema.const('ws').default('ws'),
    testMode: Schema.boolean().default(false),
  })

  export type Config = BaseConfig & WsClient.Config
  
  export const Config: Schema<Config> = Schema.intersect([
    BaseConfig,
    WsClient.Config,
  ])
  
}

ForwardClient.prototype.platform = 'forward'
