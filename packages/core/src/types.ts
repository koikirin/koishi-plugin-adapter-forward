import type { Session, Bot } from '@satorijs/satori'

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
  internalMethods?: string[]
}

export interface ActionPayload {
  action: string
  args: any[]
}

export interface UpPacketsMap {
  'meta::connect': Packet<'meta::connect', {
    token: string
  }>
  'meta::error': Packet<'meta::error', Error>
  'action::bot': Packet<'action::bot', ActionPayload>
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
