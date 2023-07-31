import { h, Dict, Bot, Universal } from '@satorijs/satori'

export function regularizeUniversalMethods<K extends keyof Universal.Methods>(
  bot: Bot, action: K, args: Parameters<Universal.Methods[K]>
) {
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
