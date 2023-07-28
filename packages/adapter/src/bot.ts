import { Adapter, Context, Logger, Quester, Schema, Time, WebSocketLayer, Bot, defineProperty, Dict, Session } from '@satorijs/satori'
import { WsServer } from './ws'
import type { Packets } from '@hieuzest/adapter-forward'

const logger = new Logger('forward')

interface Internal {
  _request: <P extends Packets>(packet: P) => Promise<Packets>
}

const kForward = Symbol.for('adapter-forward')

export class ForwardBot<T extends ForwardBot.Config = ForwardBot.Config> extends Bot<T> {
  internal: Internal
  [kForward] = true

  constructor(ctx: Context, config: T) {
    super(ctx, config)
    ForwardBot.prototype.platform = config.platform
    this.selfId = config.selfId

    if (config.protocol === 'ws-reverse') {
      ctx.plugin(WsServer, this)
    }
    
    this.internal = new Proxy({} as Internal, {
      set(target, p, newValue, receiver) {
        return Reflect.set(target, p, newValue, receiver)
      },
      get(target, p, receiver) {
        if (Reflect.has(target, p)) return Reflect.get(target, p, receiver)
        if (typeof p === 'symbol') return null
        if (!Reflect.has(target, p)) {
          logger.error('Bot not connected')
          return
        }
        return (...args: any[]) => target._request({
          type: 'action::internal', 
          payload: {
            action: p,
            args,
        }})
      },
    })

    // Setup all magic methods
    const methods: Iterable<keyof Bot> = [
      'sendMessage', 'sendPrivateMessage', 'getMessage', 'getMessageList', 'editMessage', 'deleteMessage',
      'createReaction', 'deleteReaction', 'clearReaction', 'getReactions',
      'getSelf', 'getUser', 'getFriendList', 'deleteFriend',
      'getGuild', 'getGuildList',
      'getGuildMember', 'getGuildMemberList', 'kickGuildMember', 'muteGuildMember',
      'setGuildMemberRole', 'unsetGuildMemberRole', 'getGuildRoles', 'createGuildRole', 'modifyGuildRole', 'deleteGuildRole',
      'getChannel', 'getChannelList', 'muteChannel',
      'handleFriendRequest', 'handleGuildRequest', 'handleGuildMemberRequest',
      'updateCommands',
    ]
    for (const method of methods) {
      defineProperty(this, method, (...args: any[]) => {
        if (!this.internal._request) {
          logger.error('Bot not connected')
          return
        }
        return this.internal._request({
          type: 'action::bot', 
          payload: {
            action: method,
            args,
        }})
      })
    }
  }

  async start() {
    await super.start()
  }

  async stop() {
    await super.stop()
  }


  async initialize() {
    await this.getSelf().then(data => Object.assign(this, data))
      .then(() => this.online(), error => this.offline(error))
  }
}

export namespace ForwardBot {
  export interface BaseConfig extends Bot.Config {
    platform: string
    selfId: string
    token?: string
    adapter?: string
  }

  export const BaseConfig: Schema<BaseConfig> = Schema.object({
    platform: Schema.string(),
    selfId: Schema.string().required(),
    token: Schema.string().role('secret'),
    protocol: Schema.const('ws-reverse').default('ws-reverse'),
    adapter: Schema.string(),
  })

  export type Config = BaseConfig & WsServer.Config
  
  export const Config: Schema<Config> = Schema.intersect([
    BaseConfig,
    WsServer.Config,
  ])
  
}
