import { h, Dict, Universal, Bot, arrayBufferToBase64 } from '@satorijs/satori'
import { readFile } from 'fs/promises'
import mime from 'mime'

export class TimeoutError extends Error {
  constructor(args: Dict, url: string) {
    super(`Timeout with request ${url}, args: ${JSON.stringify(args)}`)
    Object.defineProperties(this, {
      args: { value: args },
      url: { value: url },
    })
  }
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

export async function prepareElement(bot: Bot, element: h) {
  if ((element.attrs?.url as string)?.startsWith('file://')) {
    const url = new URL(element.attrs.url)
    const mimetype = mime.getType(url.pathname)
    const buffer = Buffer.from(await readFile(url))
    const base64 = arrayBufferToBase64(buffer)

    return h(element.type, {
      ...element.attrs,
      url: element.attrs.url = `data:${mimetype};base64,${base64}`
    }, await prepareElements(bot, element.children))
  } else {
    return h(element.type, element.attrs, await prepareElements(bot, element.children))
  }
}

async function prepareElements(bot: Bot, elements: h[]): Promise<h[]> {
  return Promise.all(elements.map(el => prepareElement(bot, el)))
}

export async function prepareUniversalMethods<K extends keyof Universal.Methods>(
  bot: Bot, action: K, args: Parameters<Universal.Methods[K]>
): Promise<Parameters<Universal.Methods[K]>> {
  switch (action) {
    case 'sendMessage': {
      // @ts-ignore
      args[1] = (await prepareElements(bot, h.normalize(args[1]))).join('')
      break
    }

    case 'sendPrivateMessage': {
      // @ts-ignore
      args[1] = (await prepareElements(bot, h.normalize(args[1]))).join('')
      break
    }
  }
  return args
}
