import { Adapter, Bot, Context, Logger, Quester, Schema } from 'koishi'
import { WebSocket } from 'ws'
import { } from '@hieuzest/koishi-plugin-adapter-red'
import type { Packets } from '@hieuzest/adapter-forward'

const logger = new Logger('forward-client')
logger.level = Logger.DEBUG

export class ForwardClient {
  sid: string
  ws: WebSocket

  constructor(public ctx: Context, public config: ForwardClient.Config) {
    // write your plugin here
    this.sid = `${config.platform}:${config.selfId}`

    this.ws = ctx.http.ws(config.endpoint, {
      headers: {
        'x-self-id': config.selfId,
        // 'authorization': 'Bearer ' + config.token,
      }
    })

    ctx.middleware(async (session, next) => {
      if (session.sid == this.sid && !session['_isForwarded']) {
        // console.log(session[config.platform])
        this.#send({
          type: 'meta::event', 
          payload: {
            event: session.type,
            session: session,
            payload: session[config.platform],
          }})
      }
      if (session['_isForwarded']) {
        // console.log(session.red._request)
        // console.log(await session.red.getGroups())
      }
      return next()
    }, true)

    this.ws.on('open', async () => {
      logger.debug('connection opened')
      this.#send({
        type: 'meta::connect',
        payload: {
          token: config.token,
        },
      })
    })

    this.ws.on('message', async (data) => {
      if (!data) return
      const packet: Packets = JSON.parse(data.toString())
      logger.debug('receive %o', packet)
      await this.#recv(packet)
    })

    this.ws.on('close', async () => {
      logger.debug('connection closed')
    })

    this.ws.on('error', async (err) => {
      logger.error(err)
    })

    ctx.on('dispose', () => {
      this.ws?.close()
      delete this.ws
    })
  }
  
  get bot() {
    return this.ctx.bots[this.sid]
  }

  #send<P extends Packets>(packet: P) {
    this.ws.send(JSON.stringify(packet))
  }

  async #recv<P extends Packets>(packet: P) {
    if (!this.bot) {
      this.#send({
        type: 'meta::error',
        payload: {
          code: -1,
          msg: 'Bot not found'
        }})
      return
    }
    const { type, payload } = packet
    if (type === 'action::internal') {
      const { action, args } = payload
      logger.debug('Call: ', action, args)
      try {
        this.#send({ 
          type, 
          payload: await this.bot.internal[action](args), 
          echo: packet.echo
        })
      } catch (e) {
        this.#send({
          type: 'meta::error',
          payload: {
            code: -2,
            msg: `Internal Action fail: ${action}`
          }})
      }
    } else if (type === 'action::bot') {
      const { action, args } = payload
      logger.debug('Call: ', action, args)
      try {
        this.#send({ 
          type,
          payload: await this.bot[action](args),
          echo: packet.echo
        })
      } catch (e) {
        this.#send({
          type: 'meta::error',
          payload: {
            code: -2,
            msg: `Bot Action fail: ${action}`
          }})
      }
    }
  }

}

export namespace ForwardClient {

  export interface BaseConfig extends Bot.Config {
    platform: string
    selfId: string
    token?: string
  }

  export const BaseConfig: Schema<BaseConfig> = Schema.object({
    platform: Schema.string(),
    selfId: Schema.string().description('机器人的账号。').required(),
    token: Schema.string().role('secret').description('发送信息时用于验证的字段，应与 OneBot 配置文件中的 `access_token` 保持一致。'),
  })

  export type Config = BaseConfig & Quester.Config & Adapter.WsClient.Config

  export const Config: Schema<Config> = Schema.intersect([
    BaseConfig,
    Quester.createConfig('ws://127.0.0.1:5140/forward'),
    Adapter.WsClient.Config,
  ])
}

export default ForwardClient
