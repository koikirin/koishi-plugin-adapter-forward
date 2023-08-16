import { arrayBufferToBase64, Bot, h, Session, Universal } from '@satorijs/satori'
import { readFile } from 'fs/promises'
import mime from 'mime'

export function regularizeUniversalMethods<K extends keyof Universal.Methods>(
  bot: Bot, action: K, args: Parameters<Universal.Methods[K]>,
): Parameters<Universal.Methods[K]> {
  switch (action) {
    case 'sendMessage': {
      // @ts-ignore
      if (args[3]) args[3].session = Object.assign(bot.session(), args[3].session)
      break
    }

    case 'sendPrivateMessage': {
      // @ts-ignore
      if (args[2]) args[2].session = Object.assign(bot.session(), args[2].session)
      break
    }
  }
  return args
}

export async function prepareElement(bot: Bot, element: h) {
  if ((element.attrs?.url as string)?.startsWith('file://')) {
    const url = new URL(element.attrs.url)
    const mimetype = mime.getType(url.pathname)
    const buffer = Buffer.from(await readFile(url))
    const base64 = arrayBufferToBase64(buffer)

    return h(element.type, {
      ...element.attrs,
      url: element.attrs.url = `data:${mimetype};base64,${base64}`,
    }, await prepareElements(bot, element.children))
  } else {
    return h(element.type, element.attrs, await prepareElements(bot, element.children))
  }
}

async function prepareElements(bot: Bot, elements: h[]): Promise<h[]> {
  return Promise.all(elements.map(el => prepareElement(bot, el)))
}

export async function prepareSession(session: Session): Promise<Session.Payload> {
  return { ...session.toJSON(), elements: await prepareElements(session.bot, session.elements) }
}
