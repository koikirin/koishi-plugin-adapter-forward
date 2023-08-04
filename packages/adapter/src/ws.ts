import { Adapter, Context, Logger, Schema, Time, WebSocketLayer, Quester } from '@satorijs/satori'
import { defineProperty } from 'cosmokit'
import { WebSocket } from 'ws'
import { UpPackets, DownPackets } from '@hieuzest/adapter-forward'
import { ForwardHost } from './host'
import { parseElementObjects, TimeoutError } from './utils'
import { kForward, kUniversalMethods, kInternalMethods } from '.'

const logger = new Logger('forward')

interface SharedConfig<T = 'ws' | 'ws-reverse'> {
  protocol: T
  responseTimeout?: number
}

export class WsClient extends Adapter.WsClient<ForwardHost> {
  protected accept = accept

  async prepare(bot: ForwardHost<ForwardHost.BaseConfig & WsClient.Config>) {
    const http = this.ctx.http.extend(bot.config)
    return http.ws(bot.config.endpoint)
  }
}

export namespace WsClient {
  export interface Config extends SharedConfig<'ws'>, Quester.Config, Adapter.WsClient.Config { }

  export const Config: Schema<Config> = Schema.intersect([
    Schema.object({
      protocol: Schema.const('ws').required(true),
      responseTimeout: Schema.natural().role('time').default(Time.minute).description('等待响应的时间 (单位为毫秒)。'),
    }).description('连接设置'),
    Quester.createConfig('ws://127.0.0.1:5140/forward'),
    Adapter.WsClient.Config,
  ])
}

export class WsServer extends Adapter.Server<ForwardHost<ForwardHost.BaseConfig & WsServer.Config>> {
  public wsServer?: WebSocketLayer

  constructor(ctx: Context, bot: ForwardHost) {
    super()

    const { path = '/forward' } = bot.config as WsServer.Config
    this.wsServer = ctx.router.ws(path, (socket, { headers }) => {
      logger.debug('connected')
      accept(bot, socket)
    })

    ctx.on('dispose', () => {
      logger.debug('ws server closing')
      this.wsServer.close()
    })
  }

  async stop(bot: ForwardHost) {
    bot.socket?.close()
    bot.socket = null
  }
}

export namespace WsServer {
  export interface Config extends SharedConfig<'ws-reverse'> {
    path?: string
  }

  export const Config: Schema<Config> = Schema.object({
    protocol: Schema.const('ws-reverse').required(true),
    path: Schema.string().description('服务器监听的路径。').default('/forward'),
    responseTimeout: Schema.natural().role('time').default(Time.minute).description('等待响应的时间 (单位为毫秒)。'),
  }).description('连接设置')
}

let counter = 0
const listeners: Record<number, [(response: DownPackets['payload']) => void, (reason: any) => void]> = {}

export function accept(client: ForwardHost, socket?: WebSocket) {
  socket ||= client.socket

  socket.addEventListener('message', async ({ data }) => {
    let packet: DownPackets
    try {
      packet = JSON.parse(data.toString())
    } catch (error) {
      return logger.warn('cannot parse message', data)
    }

    logger.debug('receive %o', packet)
    await processPacket(client, socket, packet)
  })

  const connectPacket: UpPackets = { type: 'meta::connect', payload: { token: client.config.token } }
  socket.send(JSON.stringify(connectPacket))
}

async function processPacket(client: ForwardHost, socket: WebSocket, packet: DownPackets) {
  const { type, payload, sid, echo } = packet

  if (echo in listeners) {
    const [resolve, reject] = listeners[echo]
    if (type === 'meta::error') {
      reject(payload)
    } else {
      resolve(payload)
    }
    delete listeners[echo]
    return
  }

  let bot = client.getBot(sid)

  switch (type) {
    case 'meta::connect': {
      break
    }

    case 'meta::event': {
      // This occur mostly when disconnect but events are just came
      if (!bot) return
      const { session: sessionPayload, payload: internalPayload } = payload
      const session = bot.session()
      defineProperty(session, kForward, true)
      Object.assign(session, sessionPayload)
      defineProperty(session, bot.platform, Object.create(bot.internal))
      Object.assign(session[bot.platform], internalPayload)
      session.elements = parseElementObjects(session.elements)
      session.content = session.elements.join('')

      bot.dispatch(session)
      break
    }

    case 'meta::status': {
      if (!bot) {
        bot = await client.addBot(sid, {
          universalMethods: payload.universalMethods,
          internalMethods: payload.internalMethods
        })
        logger.info('Connect to bot: %s', bot.sid)
        socket.addEventListener('close', () => client.removeBot(bot))

        bot.internal._send = (type, payload, rest = {}, socketArg?) => {
          socketArg ||= socket
          if (!socketArg) return
          const packet = { type, payload, sid: bot.sid, ...rest }
          logger.debug('send ws %o', packet)
          return new Promise((resolve, reject) => {
            socket.send(JSON.stringify(packet), (error) => {
              if (error) reject(error)
            })
            return resolve()
          })
        }

        bot.internal._call = (type, payload, rest = {}, socketArg?) => {
          socketArg ||= socket
          const packet = { type, payload, echo: ++counter, sid: bot.sid, ...rest }
          logger.debug('send ws %o', packet)
          return new Promise((resolve, reject) => {
            listeners[packet.echo] = [resolve, reject]
            setTimeout(() => {
              delete listeners[packet.echo]
              reject(new TimeoutError(payload, type))
            }, client.config.responseTimeout)
            socket.send(JSON.stringify(packet), (error) => {
              if (error) reject(error)
            })
          })
        }
      } else {
        if (payload.universalMethods) {
          bot[kUniversalMethods] = payload.universalMethods
          bot._updateUniversalMethods()
          logger.debug('universalMethods detected', bot[kUniversalMethods])
        }
        if (payload.internalMethods) {
          bot[kInternalMethods] = payload.internalMethods
          logger.debug('internalMethods detected', bot[kInternalMethods])
        }
      }

      if (payload.status && payload.status !== bot.status) {
        switch (payload.status) {
          case 'online':
            bot.status = 'online'
            await bot.initialize()
            break
          case 'unavailable':
            client.removeBot(bot)
            break
          default:
            bot.status = payload.status
        }
      }
      if (bot && payload.user) {
        Object.assign(bot, payload.user)
      }
    }
  }
}
