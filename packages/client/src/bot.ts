import { } from 'koishi'
import { Context, Schema, Bot, Awaitable, defineProperty, Session, Logger } from '@satorijs/satori'
import { WebSocket } from 'ws'
import { DownPacketsMap, getInternalMethodKeys } from '@hieuzest/adapter-forward'
import { WsClient, WsServer } from './ws'

const logger = new Logger('forward-client')

interface Internal {
  _send: <T extends keyof DownPacketsMap>(type: T, payload: DownPacketsMap[T]['payload'], rest?: Partial<DownPacketsMap[T]>, socket?: WebSocket) => Awaitable<void>
  _methods: string[]
  _update: (bot: Bot, socket?: WebSocket, removed?: boolean) => Promise<void>
}

const kForward = Symbol.for('adapter-forward')
const kDispath = Symbol('dispatch')

export class ForwardClient<T extends ForwardClient.Config = ForwardClient.Config> extends Bot<T> {
  internal: Internal

  constructor(ctx: Context, config: T) {
    super(ctx, config)

    this.internal = Object.create({})
    defineProperty(this.internal, '_update', (bot: Bot, socket: WebSocket, removed = false) => {
      if (!this.internal._send) return
      this.internal._send('meta::status', {
        status: removed ? 'unavailable' : bot?.status,
        user: { username: bot.username, avatar: bot.avatar },
        internalMethods: this.internal._methods,
      }, { sid: bot.sid }, socket)
    })

    this.platform = 'forward'
    this.selfId = `client`
    this.hidden = true

    if (config.protocol === 'ws') {
      ctx.plugin(WsClient, this)
    } else if (config.protocol === 'ws-reverse') {
      ctx.plugin(WsServer, this)
    }

    const hookInnerBot = () => {
      this.getInnerBots().filter(bot => !bot[kDispath]).forEach(bot => {
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
            this.internal._update(bot)
          }).catch(e => logger.warn('failed to load internalMethods', e))
        }
      })
    }

    hookInnerBot()

    ctx.on('bot-added', (botArg) => {
      hookInnerBot()
    })

    ctx.on('bot-removed', (bot) => {
      if (!bot[kForward] && this.validateSid(bot)) {
        this.internal._methods = []
        this.internal._update(bot, null, true)
      }
    })

    ctx.on('bot-status-updated', (botArg) => {
      this.getInnerBots().find(bot => {
        if (bot === botArg) this.internal._update(bot)
      })
    })

    ctx.on('dispose', () => {
      this.getInnerBots().filter(bot => bot[kDispath]).forEach(bot => {
        bot.dispatch = bot[kDispath]
        defineProperty(bot, kDispath, null)
      })
    })
  }

  dispatchInner(session: Session) {
    if (!this.internal._send) return
    if (!session[kForward] && this.validateSid(session.bot))
      this.internal?._send('meta::event', {
        event: session.type,
        session: session,
        payload: session[session.platform],
      }, { sid: session.sid })
  }

  validateSid(arg: string | Bot) {
    if (typeof arg === 'string') return (!this.config.sids.length || this.config.sids.includes(arg))
    else return (!arg || (!arg.hidden && arg.selfId))
      && (!this.config.sids.length || this.config.sids.includes(arg.sid))
  }

  getInnerBots() {
    return this.ctx.bots.filter(bot => !bot[kForward] && this.validateSid(bot))
  }

  getInnerBot(sid: string) {
    return this.ctx.bots.find(bot => !bot[kForward] && bot.sid === sid)
    this.getSelf
  }
}

export namespace ForwardClient {
  export interface BaseConfig extends Bot.Config {
    sids: string[]
    token?: string
    avoidLoopback: boolean
  }

  export const BaseConfig: Schema<BaseConfig> = Schema.object({
    sids: Schema.array(String).default([]),
    token: Schema.string().role('secret'),
    protocol: Schema.union(['ws', 'ws-reverse']).default('ws'),
    avoidLoopback: Schema.boolean().default(true),
  })

  export interface AdvancedConfig {
    loadInternalMethods: boolean
  }

  export const AdvancedConfig: Schema<AdvancedConfig> = Schema.object({
    loadInternalMethods: Schema.boolean().description('Requires typescript as dependency').default(false),
  }).description('高级设置')

  export type Config = BaseConfig & AdvancedConfig & (WsServer.Config | WsClient.Config)

  export const Config: Schema<Config> = Schema.intersect([
    BaseConfig,
    AdvancedConfig,
    Schema.union([
      WsServer.Config,
      WsClient.Config,
    ]),
  ])
}

ForwardClient.prototype.platform = 'forward'
