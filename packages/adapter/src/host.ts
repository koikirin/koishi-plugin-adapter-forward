import { Context, Schema, Bot } from '@satorijs/satori'
import { WsClient, WsServer } from './ws'
import { ForwardBot } from './bot'

const kForward = Symbol.for('adapter-forward')

export class ForwardHost<T extends ForwardHost.Config = ForwardHost.Config> extends Bot<T> {
  constructor(ctx: Context, config: T) {
    super(ctx, config)
    this.platform = 'forward'
    this.selfId = 'host'
    this.hidden = true

    if (config.protocol === 'ws') {
      ctx.plugin(WsClient, this)
    } else if (config.protocol === 'ws-reverse') {
      ctx.plugin(WsServer, this)
    }
  }

  validateSid(sid: string) {
    return !this.config.sids.length || this.config.sids.includes(sid)
  }

  getBots(): ForwardBot[] {
    return this.ctx.bots.filter(bot => bot[kForward] && this.validateSid(bot.sid)) as any
  }

  getBot(sid: string): ForwardBot {
    return this.ctx.bots.find(bot => bot[kForward] && bot.sid === sid) as any
  }

  async addBot(sid: string): Promise<ForwardBot> {
    const [platform, selfId] = parsePlatform(sid)
    return new Promise((resolve) => {
      this.ctx.plugin(ForwardBot, { platform, selfId, callback: resolve })
    })
  }

  removeBot(bot: ForwardBot): boolean {
    return bot.ctx.scope.dispose()
  }
}

export namespace ForwardHost {
  export interface BaseConfig extends Bot.Config {
    sids: string[]
    token?: string
  }

  export const BaseConfig: Schema<BaseConfig> = Schema.object({
    sids: Schema.array(String).default([]),
    token: Schema.string().role('secret'),
    protocol: Schema.union(['ws', 'ws-reverse'] as const).default('ws-reverse'),
  })

  export type Config = BaseConfig & (WsServer.Config | WsClient.Config)

  export const Config: Schema<Config> = Schema.intersect([
    BaseConfig,
    Schema.union([
      WsServer.Config,
      WsClient.Config,
    ]),
  ])
}

function parsePlatform(sid: string) {
  let platform: string, selfId: string
  const index = sid.indexOf(':', sid.startsWith('sandbox:') ? 8 : 0)
  platform = sid.slice(0, index)
  selfId = sid.slice(index + 1)
  return [platform, selfId]
}
