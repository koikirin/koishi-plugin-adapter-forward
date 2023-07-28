import type { Session } from '@satorijs/satori'

export interface Packet<T extends string, P> {
  type: T
  payload?: P
  echo?: number
}

export namespace Connect {
  export type Request = Packet<'meta::connect', {
    token: string
  }>

  export type Response = Packet<'meta::connect', {
    version: string
    name: string
  }>
}

export type Connect = Connect.Request | Connect.Response

export type Error = Packet<'meta::error', {
  code: number
  msg: string
}>

export interface EventPayload {
  event: string
  session: Session
  payload: any
}

export type EventPacket = Packet<'meta::event', EventPayload>

export interface ActionPayload {
  action: string
  args: any[]
}

export namespace BotAction {
  export type Request = Packet<'action::bot', ActionPayload>

  export type Response = Packet<'action::bot', any>
}

export type BotActionPacket = BotAction.Request | BotAction.Response

export namespace InternalAction {
  export type Request = Packet<'action::internal', ActionPayload>
  
  export type Response = Packet<'action::internal', any>
}

export type InternalActionPacket = InternalAction.Request | InternalAction.Response

export type RequestPackets = Connect.Request | EventPacket | BotAction.Request | InternalAction.Request

export type ResponsePackets = Connect.Response | BotAction.Response | InternalAction.Response | Error

export type Packets = RequestPackets | ResponsePackets
