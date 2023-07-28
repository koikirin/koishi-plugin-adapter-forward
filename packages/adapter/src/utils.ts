import { h, Adapter, Context, Logger, Quester, Schema, Time, WebSocketLayer, Bot, defineProperty, Dict, Session } from '@satorijs/satori'
// import {}

export class TimeoutError extends Error {
  constructor(args: Dict, url: string) {
    super(`Timeout with request ${url}, args: ${JSON.stringify(args)}`)
    Object.defineProperties(this, {
      args: { value: args },
      url: { value: url },
    })
  }
}

export interface Response {
  status: string
  retcode: number
  data: any
  echo?: number
}

export async function dispatchSession(bot: Bot, session: Session) {

  if (!session) return
  // defineProperty(session, 'onebot', Object.create(bot.internal))
  // Object.assign(session.onebot, data)
  bot.dispatch(session)
}

export function parseElementObject(content: any) {
  if (typeof content === 'object' && content.type && content.attrs && content.children) {
    const { type, attrs, children }: h = content
    return h(type, attrs, children.map(parseElementObject))
  } else throw new TypeError(`Invalid element object ${content}`)
}

export function parseElementObjects(content: any[]) {
  return content.map(parseElementObject)
}