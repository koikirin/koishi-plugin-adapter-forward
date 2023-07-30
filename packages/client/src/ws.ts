import { Adapter, Context, Logger, Quester, Schema, Time, WebSocketLayer } from '@satorijs/satori'
import { ForwardClient } from './bot'
import { RequestPackets, ResponsePackets } from '@hieuzest/adapter-forward'

const logger = new Logger('forward-client')

interface SharedConfig<T = 'ws' | 'ws-reverse'> {
  protocol: T
  responseTimeout?: number
}

export class WsClient extends Adapter.WsClient<ForwardClient> {
  protected accept = accept

  async prepare(bot: ForwardClient<ForwardClient.BaseConfig & ForwardClient.AdvancedConfig & WsClient.Config>) {
    const http = this.ctx.http.extend(bot.config)
    console.log(bot.config)
    return http.ws(bot.config.endpoint, {
      headers: {
        'x-forward-selfid': bot.innerSid
      }
    })
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

      const sid = headers['x-forward-selfid']?.toString()
      const bot = ctx.bots.find(b => b instanceof ForwardClient && b.innerSid === sid) as ForwardClient
      if (!bot) return socket.close(1008, 'invalid x-self-id')
      bot.socket = socket
      accept(bot)
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

async function accept(bot: ForwardClient) {
  const unavailable = (echo) => {
    bot.internal._request({
      type: 'meta::error', echo,
      payload: {
        code: -1,
        msg: `Bot unavailable`,
      },
    })
  }

  bot.socket.addEventListener('message', async ({ data }) => {
    let packet: ResponsePackets
    try {
      packet = JSON.parse(data.toString())
    } catch (error) {
      return logger.warn('cannot parse message', data)
    }

    logger.debug('receive %o', packet)

    const { type, payload, echo } = packet

    if (type === 'meta::connect') {
      let { name, version } = payload
      logger.info('Initialized with protocol %s %s', name, version)
      bot.internal._update()
    } else if (type === 'action::internal') {
      if (!bot.getInnerBot()) return unavailable(echo)
      const { action, args } = payload
      logger.debug('call internal', action)
      try {
        bot.internal._request({
          type, echo,
          payload: await bot.getInnerBot().internal[action](args),
        })
      } catch (e) {
        logger.error(e)
        bot.internal._request({
          type: 'meta::error', echo,
          payload: {
            code: -2,
            msg: `Internal Action fail: ${action}`,
          },
        })
      }
    } else if (type === 'action::bot') {
      if (!bot.getInnerBot()) return unavailable(echo)
      const { action, args } = payload
      logger.debug('call bot', action)
      try {
        bot.internal._request({
          type, echo,
          payload: await bot.getInnerBot()[action](args),
        })
      } catch (e) {
        logger.error(e)
        bot.internal._request({
          type: 'meta::error', echo,
          payload: {
            code: -2,
            msg: `Bot Action fail: ${action}`,
          }
        })
      }
    }
  })

  bot.internal._request = <P extends RequestPackets>(packet: P) => {
    if (!bot.socket) return
    logger.debug('send ws %o', packet)
    bot.socket.send(JSON.stringify(packet))
  }

  bot.internal._request({
    type: 'meta::connect',
    payload: { token: bot.config.token }
  })
}
