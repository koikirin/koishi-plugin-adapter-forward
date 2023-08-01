import type { Session, Bot, Universal } from '@satorijs/satori'

export interface Packet<T extends string, P> {
  type: T
  payload?: P
  echo?: number
  sid?: string
}

export interface Error {
  code: number
  msg: string
}

export interface EventPayload {
  event: string
  session: Session
  payload: any
}

export interface StatusPayload {
  status?: Bot.Status | 'unavailable'
  user?: Partial<Universal.User>
  universalMethods?: (keyof Universal.Methods)[]
  internalMethods?: string[]
}

export interface ActionPayload<T extends string = string, M extends any[] = any[]> {
  action: T
  args: M
}

export interface BotActionPayload<T extends keyof Universal.Methods = keyof Universal.Methods> {
  action: T
  args: Parameters<Universal.Methods[T]>
}

export interface UpPacketsMap {
  'meta::connect': Packet<'meta::connect', {
    token: string
  }>
  'meta::error': Packet<'meta::error', Error>
  'action::bot': Packet<'action::bot', BotActionPayload>
  'action::internal': Packet<'action::internal', ActionPayload>
}

export interface DownPacketsMap {
  'meta::connect': Packet<'meta::connect', {
    version: string
    name: string
  }>
  'meta::error': Packet<'meta::error', Error>
  'meta::event': Packet<'meta::event', EventPayload>
  'meta::status': Packet<'meta::status', StatusPayload>
  'action::bot': Packet<'action::bot', any>
  'action::internal': Packet<'action::internal', any>
}

export type UpPackets = UpPacketsMap[keyof UpPacketsMap]
export type DownPackets = DownPacketsMap[keyof DownPacketsMap]

export const universalMethods: readonly (keyof Universal.Methods)[] = [
  'sendMessage', 'sendPrivateMessage', 'getMessage', 'getMessageList', 'editMessage', 'deleteMessage',
  'createReaction', 'deleteReaction', 'clearReaction', 'getReactions',
  'getSelf', 'getUser', 'getFriendList', 'deleteFriend',
  'getGuild', 'getGuildList',
  'getGuildMember', 'getGuildMemberList', 'kickGuildMember', 'muteGuildMember',
  'setGuildMemberRole', 'unsetGuildMemberRole', 'getGuildRoles', 'createGuildRole', 'modifyGuildRole', 'deleteGuildRole',
  'getChannel', 'getChannelList', 'muteChannel',
  'handleFriendRequest', 'handleGuildRequest', 'handleGuildMemberRequest',
  'updateCommands',
] as const

export const predefinedUniversalMethods: readonly (keyof Universal.Methods)[] = [
  'sendMessage', 'sendPrivateMessage'
] as const
