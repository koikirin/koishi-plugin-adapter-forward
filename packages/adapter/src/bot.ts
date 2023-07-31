import { Context, Logger, Bot, defineProperty, Awaitable, Universal } from '@satorijs/satori'
import { WebSocket } from 'ws'
import { UpPacketsMap } from '@hieuzest/adapter-forward'

const logger = new Logger('forward')

interface Internal {
  _send: <T extends keyof UpPacketsMap>(type: T, payload: UpPacketsMap[T]['payload'], rest?: Partial<UpPacketsMap[T]>, socket?: WebSocket) => Awaitable<void>
  _call: <T extends keyof UpPacketsMap>(type: T, payload: UpPacketsMap[T]['payload'], rest?: Partial<UpPacketsMap[T]>, socket?: WebSocket) => Awaitable<any>
  _methods: string[]
  _update: (bot: Bot, socket?: WebSocket) => Promise<void>
}
const kForward = Symbol.for('adapter-forward')

export class ForwardBot<T extends ForwardBot.Config = ForwardBot.Config> extends Bot<T> {
  internal: Internal
  [kForward] = true
  _internalMethods: string[]

  constructor(ctx: Context, config: T) {
    super(ctx, config)
    ForwardBot.prototype.platform = config.platform
    this.selfId = config.selfId

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
        if (this._internalMethods?.includes(p)) {
          return (...args: any[]) => target._call('action::internal', {
            action: p,
            args,
          })
        }
      },
    })

    // Setup all magic methods
    const methods: Iterable<keyof Universal.Methods> = [
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
      defineProperty(this, method, (...args: any) => {
        if (!this.internal._send) {
          logger.error('Bot not connected')
          return
        }
        return this.internal._call('action::bot', {
          action: method,
          args: args,
        })
      })
    }

    if (config.callback) {
      config.callback(this)
      delete config.callback
    }
  }

  async initialize() {
    await this.getSelf().then(data => Object.assign(this, data))
  }
}

export namespace ForwardBot {
  export interface Config extends Bot.Config {
    callback: (bot: ForwardBot) => Awaitable<void>
  }
}

export default ForwardBot
