import { Adapter, Context, Logger, Quester, Schema, Time, WebSocketLayer, Session, h } from '@satorijs/satori'
import { ForwardClient } from './bot'
import { Packets, ResponsePackets } from '@hieuzest/adapter-forward'

const logger = new Logger('forward-client')

interface SharedConfig<T = 'ws'> {
  protocol: T
  responseTimeout?: number
}

export class WsClient extends Adapter.WsClient<ForwardClient> {
  public wsServer?: WebSocketLayer

  constructor(ctx: Context, bot: ForwardClient) {
    super(ctx, bot)
  }

  get innerBot() {
    return this.bot.getInnerBot()
  }

  async prepare(bot: ForwardClient) {
    const http = this.ctx.http.extend(bot.config)
    return http.ws(bot.config.endpoint, {
      headers: {
        'x-forward-selfid': bot.innerSid
      }
    })
  }

  async accept(bot: ForwardClient) {

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
        return
      } else if (type === 'action::internal') {
        if (!this.innerBot) return unavailable(echo)
        const { action, args } = payload
        logger.debug('call internal', action)
        try {
          bot.internal._request({
            type, echo,
            payload: await this.innerBot.internal[action](args),
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
        if (!this.innerBot) return unavailable(echo)
        const { action, args } = payload
        logger.debug('call bot', action)
        try {
          bot.internal._request({
            type, echo,
            payload: await this.innerBot[action](args),
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

    bot.internal._request = <P extends Packets>(packet: P) => {
      if (!bot.socket) return
      logger.debug('send ws %o', packet)
      bot.socket.send(JSON.stringify(packet))
    }

    bot.internal._request({
      type: 'meta::connect',
      payload: { token: bot.config.token }
    })
  }
}

export namespace WsClient {
  export interface Config extends SharedConfig<'ws'>, Quester.Config, Adapter.WsClient.Config { }

  export const Config: Schema<Config> = Schema.intersect([
    Schema.object({
      protocol: Schema.const('ws'),
      responseTimeout: Schema.natural().role('time').default(Time.minute).description('等待响应的时间 (单位为毫秒)。'),
    }).description('连接设置'),
    Quester.createConfig('ws://127.0.0.1:5140/forward'),
    Adapter.WsClient.Config,
  ])
}
