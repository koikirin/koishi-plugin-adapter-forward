import { h, Dict } from '@satorijs/satori'

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
