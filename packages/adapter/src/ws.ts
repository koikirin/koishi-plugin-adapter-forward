import { Adapter, Context, Logger, Quester, Schema, Time, WebSocketLayer, Session, h } from '@satorijs/satori'
import { ForwardBot } from './bot'
import { defineProperty, isNullable } from 'cosmokit'
import { parseElementObjects, TimeoutError } from './utils'
import type { Packets, RequestPackets, ResponsePackets } from '@hieuzest/adapter-forward'

const logger = new Logger('forward')
logger.level = Logger.DEBUG
const kForward = Symbol.for('adapter-forward')

interface SharedConfig<T = 'ws-reverse'> {
  protocol: T
  responseTimeout?: number
}

export class WsServer extends Adapter.Server<ForwardBot<ForwardBot.BaseConfig & WsServer.Config>> {
  public wsServer?: WebSocketLayer

  constructor(ctx: Context, bot: ForwardBot) {
    super()

    const { path = '/forward' } = bot.config
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
const listeners: Record<number, [(response: Packets['payload']) => void, (reason: any) => void]> = {}

export function accept(bot: ForwardBot<ForwardBot.BaseConfig & SharedConfig>) {
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
      bot.internal._request = ({ type, payload }) => {
        const data = { type, payload, echo: ++counter }
        return new Promise((resolve, reject) => {
          listeners[data.echo] = [resolve, reject]
          setTimeout(() => {
            delete listeners[data.echo]
            reject(new TimeoutError(payload, type))
          }, bot.config.responseTimeout)
          bot.socket.send(JSON.stringify(data), (error) => {
            if (error) reject(error)
          })
        })
      }
      bot.internal._request({
        type: 'meta::connect',
        payload: { name: 'adapter-forward', version: '1.0.0' }
      })
      bot.initialize()
    } else if (type === 'meta::event') {
      const { session: sessionPayload, payload: internalPayload } = payload
      const session = bot.session()
      defineProperty(session, kForward, true)
      Object.assign(session, sessionPayload)
      defineProperty(session, bot.platform, Object.create(bot.internal))
      Object.assign(session[bot.platform], internalPayload)
      if (bot.config.adapter) {
        defineProperty(session, bot.config.adapter, Object.create(bot.internal))
        Object.assign(session[bot.config.adapter], internalPayload)
      }
      session.elements = parseElementObjects(session.elements)
      session.content = session.elements.join('')

      bot.dispatch(session)
    }
  })

  bot.socket.addEventListener('close', () => {
    delete bot.internal._request
  })

  // setTimeout(() => {
  //   if (!bot.internal?._request) bot.socket?.close()
  // }, 10 * 1000)

}