import { Adapter, Context, Logger, Schema, Time, WebSocketLayer, Quester } from '@satorijs/satori'
import { ForwardBot } from './bot'
import { defineProperty } from 'cosmokit'
import { parseElementObjects, TimeoutError } from './utils'
import { RequestPackets, ResponsePackets } from '@hieuzest/adapter-forward'

const logger = new Logger('forward')
const kForward = Symbol.for('adapter-forward')

interface SharedConfig<T = 'ws' | 'ws-reverse'> {
  protocol: T
  responseTimeout?: number
}

export class WsClient extends Adapter.WsClient<ForwardBot> {
  protected accept = accept

  async prepare(bot: ForwardBot<ForwardBot.BaseConfig & ForwardBot.AdvancedConfig & WsClient.Config>) {
    const http = this.ctx.http.extend(bot.config)
    return http.ws(bot.config.endpoint, {
      headers: {
        'x-forward-selfid': `${bot.config.platform}:${bot.config.selfId}`
      }
    })
  }
}

export namespace WsClient {
  export interface Config extends SharedConfig<'ws'>, Quester.Config, Adapter.WsClient.Config { }

  export const Config: Schema<Config> = Schema.intersect([
    Schema.object({
      protocol: Schema.const('ws').required(process.env.KOISHI_ENV !== 'browser'),
      responseTimeout: Schema.natural().role('time').default(Time.minute).description('等待响应的时间 (单位为毫秒)。'),
    }).description('连接设置'),
    Quester.createConfig('ws://127.0.0.1:5140/forward'),
    Adapter.WsClient.Config,
  ])
}

export class WsServer extends Adapter.Server<ForwardBot<ForwardBot.BaseConfig & ForwardBot.AdvancedConfig & WsServer.Config>> {
  public wsServer?: WebSocketLayer

  constructor(ctx: Context, bot: ForwardBot) {
    super()

    const { path = '/forward' } = bot.config as WsServer.Config
    this.wsServer = ctx.router.ws(path, (socket, { headers }) => {
      logger.debug('connected')

      const sid = headers['x-forward-selfid']?.toString()
      const bot = ctx.bots.find(b => b instanceof ForwardBot && b.sid === sid) as ForwardBot
      if (!bot) return socket.close(1008, 'invalid x-self-id')
      bot.socket = socket
      accept(bot)
    })

    ctx.on('dispose', () => {
      logger.debug('ws server closing')
      this.wsServer.close()
    })
  }

  async stop(bot: ForwardBot) {
    bot.socket?.close()
    bot.socket = null
  }
}

export namespace WsServer {
  export interface Config extends SharedConfig<'ws-reverse'> {
    path?: string
  }

  export const Config: Schema<Config> = Schema.object({
    protocol: Schema.const('ws-reverse').required(process.env.KOISHI_ENV === 'browser'),
    path: Schema.string().description('服务器监听的路径。').default('/forward'),
    responseTimeout: Schema.natural().role('time').default(Time.minute).description('等待响应的时间 (单位为毫秒)。'),
  }).description('连接设置')
}

let counter = 0
const listeners: Record<number, [(response: ResponsePackets['payload']) => void, (reason: any) => void]> = {}

export function accept(bot: ForwardBot) {
  bot.socket.addEventListener('message', ({ data }) => {
    let parsed: any
    try {
      parsed = JSON.parse(data.toString())
    } catch (error) {
      return logger.warn('cannot parse message', data)
    }

    logger.debug('receive %o', parsed)

    const { type, payload, echo }: RequestPackets = parsed

    if (echo in listeners) {
      const [resolve, reject] = listeners[parsed.echo]
      if (type === 'meta::error') {
        reject(new Error(payload.msg))
      } else {
        resolve(payload)
      }
      delete listeners[parsed.echo]
      return
    }

    if (type === 'meta::connect') {
      const { token } = payload
      if (token !== bot.config.token) {
        bot.socket?.close(1007, 'invalid token')
        return
      }
      clearTimeout(timeout)

      bot.internal._request = ({ type, payload }, callback: boolean = true) => {
        const packet = { type, payload, echo: ++counter }
        logger.debug('send ws %o', packet)
        return new Promise((resolve, reject) => {
          if (callback) {
            listeners[packet.echo] = [resolve, reject]
            setTimeout(() => {
              delete listeners[packet.echo]
              reject(new TimeoutError(payload, type))
            }, bot.config.responseTimeout)
          }
          bot.socket.send(JSON.stringify(packet), (error) => {
            if (error) reject(error)
          })
        })
      }
      bot.internal._request({
        type: 'meta::connect',
        payload: { name: 'adapter-forward', version: '1.2.0' }
      }, false)
      bot.initialize()
    } else if (type === 'meta::event') {
      const { session: sessionPayload, payload: internalPayload } = payload
      const session = bot.session()
      defineProperty(session, kForward, true)
      Object.assign(session, sessionPayload)
      defineProperty(session, bot.platform, Object.create(bot.internal))
      Object.assign(session[bot.platform], internalPayload)
      if (bot.config.originalProtocolName) {
        defineProperty(session, bot.config.originalProtocolName, Object.create(bot.internal))
        Object.assign(session[bot.config.originalProtocolName], internalPayload)
      }
      session.elements = parseElementObjects(session.elements)
      session.content = session.elements.join('')

      bot.dispatch(session)
    } else if (type === 'meta::status') {
      if (payload.status) {
        if (payload.status === 'unavailable') bot.status = 'offline'
        else bot.status = payload.status
      }
      if (payload.internalMethods) {
        bot._internalMethods = payload.internalMethods
        logger.debug('internalMethods detected', bot._internalMethods)
      }
    }
  })

  bot.socket.addEventListener('close', () => {
    delete bot.internal._request
    clearTimeout(timeout)
  })

  const timeout = setTimeout(() => {
    if (!bot.internal?._request) bot.socket?.close()
  }, 10 * 1000)
}
