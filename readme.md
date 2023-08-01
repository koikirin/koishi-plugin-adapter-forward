# koishi-plugin-adapter-forward

_Forward your adapter!_

将你的 Bots 转发至其他 Koishi 实例

## @hieuzest/client-forward

转发所处 Koishi 实例上的所有有效非隐藏的 Bots

当`sids`列表被配置时，只转发`sids`中包含的 Bots

配置高级选项可以避免部分依赖具体平台适配器在使用此插件时产生的问题

## @hieuzest/adapter-forward

接收并构造被转发的 Bots

当`sids`列表被配置时，只接收`sids`中包含的 Bots

## 此插件转发的对象

- Sessions (message / non-message)
- Bot Satori APIs (Universal.Methods)
- Bot Internal APIs
- Bot Internal Payload
