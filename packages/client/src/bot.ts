import { } from 'koishi'
import { Context, Schema, Bot, Awaitable, defineProperty, Session, Logger, Universal } from '@satorijs/satori'
import { WebSocket } from 'ws'
import { DownPacketsMap, getInternalMethodKeys, universalMethods } from '@hieuzest/adapter-forward'
import { WsClient, WsServer } from './ws'
import { prepareSession } from './utils'

const logger = new Logger('forward-client')
const kDispath = Symbol('adapter-forward/dispatch')
const kForward = Symbol.for('adapter-forward')
const kUniversalMethods = Symbol.for('adapter-forward/universalMethods')
const kInternalMethods = Symbol.for('adapter-forward/internalMethods')

interface Internal {
  _send: <T extends keyof DownPacketsMap>(type: T, payload: DownPacketsMap[T]['payload'], rest?: Partial<DownPacketsMap[T]>, socket?: WebSocket) => Awaitable<void>
  _update: (bot: Bot, socket?: WebSocket, removed?: boolean) => Promise<void>
}

declare module '@satorijs/satori' {
  interface Bot {
    [kUniversalMethods]?: (keyof Universal.Methods)[]
    [kInternalMethods]?: string[]
  }
}

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
        universalMethods: bot[kUniversalMethods],
        internalMethods: bot[kInternalMethods],
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

        if (config.loadUniversalMethods) {
          bot[kUniversalMethods] = universalMethods.filter(key => bot[key])
        }

        if (config.loadInternalMethods) {
          getInternalMethodKeys({
            filePath: ctx.loader.cache[ctx.loader.keyFor(bot.ctx.runtime.plugin)]
          }).then(methods => {
            if (methods && methods.length) bot[kInternalMethods] = methods
            else delete bot[kInternalMethods]
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

  async dispatchInner(session: Session) {
    if (!this.internal._send) return
    if (!session[kForward] && this.validateSid(session.bot))
      this.internal?._send('meta::event', {
        event: session.type,
        session: await prepareSession(session),
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
  }
}

export namespace ForwardClient {
  export interface BaseConfig extends Bot.Config {
    sids: string[]
    token?: string
  }

  export const BaseConfig: Schema<BaseConfig> = Schema.object({
    sids: Schema.array(String).default([]),
    token: Schema.string().role('secret'),
    protocol: Schema.union(['ws', 'ws-reverse']).default('ws'),
  })

  export interface AdvancedConfig {
    loadUniversalMethods: boolean
    loadInternalMethods: boolean
  }

  export const AdvancedConfig: Schema<AdvancedConfig> = Schema.object({
    loadUniversalMethods: Schema.boolean()
      .description('导入SatoriApi列表').default(true),
    loadInternalMethods: Schema.boolean()
      .description('导入InternalApi列表(此选项需要typescript依赖)').default(false),
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
