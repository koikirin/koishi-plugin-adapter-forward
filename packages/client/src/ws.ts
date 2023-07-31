import { Adapter, Context, Logger, Quester, Schema, Time, WebSocketLayer, Awaitable } from '@satorijs/satori'
import { WebSocket } from 'ws'
import { UpPackets } from '@hieuzest/adapter-forward'
import { ForwardClient } from './bot'

const logger = new Logger('forward-client')

interface SharedConfig<T = 'ws' | 'ws-reverse'> {
  protocol: T
  responseTimeout?: number
}

export class WsClient extends Adapter.WsClient<ForwardClient> {
  protected accept = accept

  async prepare(bot: ForwardClient<ForwardClient.BaseConfig & ForwardClient.AdvancedConfig & WsClient.Config>) {
    const http = this.ctx.http.extend(bot.config)
    return http.ws(bot.config.endpoint)
  }
}

export namespace WsClient {
  export interface Config extends SharedConfig<'ws'>, Quester.Config, Adapter.WsClient.Config { }

  export const Config: Schema<Config> = Schema.intersect([
    Schema.object({
      protocol: Schema.const('ws').required(process.env.KOISHI_ENV === 'browser'),
      responseTimeout: Schema.natural().role('time').default(Time.minute).description('等待响应的时间 (单位为毫秒)。'),
    }).description('连接设置'),
    Quester.createConfig('ws://127.0.0.1:5140/forward'),
    Adapter.WsClient.Config,
  ])
}

export class WsServer extends Adapter.Server<ForwardClient<ForwardClient.BaseConfig & ForwardClient.AdvancedConfig & WsServer.Config>> {
  public wsServer?: WebSocketLayer

  constructor(ctx: Context, bot: ForwardClient) {
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

  async stop(bot: ForwardClient) {
    bot.socket?.close()
    bot.socket = null
  }
}

export namespace WsServer {
  export interface Config extends SharedConfig<'ws-reverse'> {
    path?: string
  }

  export const Config: Schema<Config> = Schema.object({
    protocol: Schema.const('ws-reverse').required(process.env.KOISHI_ENV !== 'browser'),
    path: Schema.string().description('服务器监听的路径。').default('/forward'),
    responseTimeout: Schema.natural().role('time').default(Time.minute).description('等待响应的时间 (单位为毫秒)。'),
  }).description('连接设置')
}

async function accept(client: ForwardClient, socket?: WebSocket) {
  socket ||= client.socket

  socket.addEventListener('message', async ({ data }) => {
    let packet: UpPackets
    try {
      packet = JSON.parse(data.toString())
    } catch (error) {
      return logger.warn('cannot parse message', data)
    }

    logger.debug('receive %o', packet)
    await processPacket(client, socket, packet)
  })

  client.internal._send = (type, payload, rest = {}, socketArg?) => {
    socketArg ||= socket
    if (!socketArg) return
    const packet = { type, payload, ...rest }
    logger.debug('send ws %o', packet)
    socket.send(JSON.stringify(packet))
  }

  socket.addEventListener('close', () => {
    if (client.config.protocol === 'ws-reverse' && (client.adapter as WsServer).wsServer.clients.size) return
    delete client.internal._send
  })
}

async function processPacket(client: ForwardClient, socket: WebSocket, packet: UpPackets) {
  const { type, payload, sid, echo } = packet

  const unavailable = () => {
    send('meta::error', {
      code: -1,
      msg: `Bot unavailable`,
    }, { echo })
  }

  const send: typeof client.internal._send = (type, peyload, rest = {}, socket?) => {
    return client.internal._send(type, peyload, { echo, ...rest }, socket)
  }

  switch (type) {
    case 'meta::connect': {
      const { token } = payload
      if (token !== client.config.token) {
        socket?.close(1007, 'invalid token')
        return
      }
      client.getInnerBots().forEach(innerBot => client.internal._update(innerBot, socket))
      break
    }

    case 'action::bot': {
      const bot = client.getInnerBot(sid)
      if (!bot) return unavailable()
      const { action, args } = payload
      logger.debug('call bot', action)
      try {
        send(type, await bot[action](args), { echo })
      } catch (e) {
        // logger.error(e)
        send('meta::error', {
          code: -2,
          msg: `Bot Action fail: ${action}`,
        }, { echo })
      }
      break
    }

    case 'action::internal': {
      const bot = client.getInnerBot(sid)
      if (!bot) return unavailable()
      const { action, args } = payload
      logger.debug('call internal', action)
      try {
        send(type, await bot.internal[action](args), { echo })
      } catch (e) {
        // logger.error(e)
        send('meta::error', {
          code: -3,
          msg: `Internal Action fail: ${action}`,
        }, { echo })
      }
      break
    }
  }
}
