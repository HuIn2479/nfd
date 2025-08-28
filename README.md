## 更新

欢迎使用我们 NFD2.0 项目 🎉，1 分钟内快速搭建教程：

> 用户先去[@BotFather](https://t.me/NodeForwardBot/BotFather)，输入 `/newbot` ，按照指引输入你要创建的机器人的昵称和名字，点击复制机器人吐出的 token
>
> 然后到[@NodeForwardBot](https://t.me/NodeForwardBot)粘贴，完活。
>
> 详细信息可以参考：[https://www.nodeseek.com/post-286885-1](https://www.nodeseek.com/post-286885-1)

NFD2.0 拥有无限配额（自建有每日 1k 消息上限），且托管在[cloudflare snippets](https://developers.cloudflare.com/rules/snippets/)，理论上不会掉线。如果需要自建，参考下面的自建教程。

# NFD

No Fraud / Node Forward Bot

一个基于 cloudflare worker 的 telegram 消息转发 bot，集成了反欺诈功能

## 特点

- 基于 cloudflare worker 搭建，能够实现以下效果
  - 搭建成本低，一个 js 文件即可完成搭建
  - 不需要额外的域名，利用 worker 自带域名即可
  - 基于 worker kv 实现永久数据储存
  - 稳定，全球 cdn 转发
- 接入反欺诈系统，当聊天对象有诈骗历史时，自动发出提醒
- 支持屏蔽用户，避免被骚扰

## 搭建方法

1. 从[@BotFather](https://t.me/BotFather)获取 token，并且可以发送`/setjoingroups`来禁止此 Bot 被添加到群组
2. 从[uuidgenerator](https://www.uuidgenerator.net/)获取一个随机 uuid 作为 secret
3. 从[@username_to_id_bot](https://t.me/username_to_id_bot)获取你的用户 id
4. 登录[cloudflare](https://workers.cloudflare.com/)，创建一个 worker
5. 配置 worker 的变量
   - 增加一个`ENV_BOT_TOKEN`变量，数值为从步骤 1 中获得的 token
   - 增加一个`ENV_BOT_SECRET`变量，数值为从步骤 2 中获得的 secret
   - 增加一个`ENV_ADMIN_UID`变量，数值为从步骤 3 中获得的用户 id
6. 绑定 kv 数据库，创建一个 Namespace Name 为`nfd`的 kv 数据库，在 setting -> variable 中设置`KV Namespace Bindings`：nfd -> nfd
7. 点击`Quick Edit`，复制[这个文件](./worker.js)到编辑器中
8. 通过打开`https://xxx.workers.dev/registerWebhook`来注册 websoket

## 使用方法

- 当其他用户给 bot 发消息，会被转发到 bot 创建者
- 用户回复普通文字给转发的消息时，会回复到原消息发送者
- 用户回复`/block`, `/unblock`, `/checkblock`等命令会执行相关指令，**不会**回复到原消息发送者

## 欺诈数据源

- 文件[fraud.db](./fraud.db)为欺诈数据，格式为每行一个 uid
- 可以通过 pr 扩展本数据，也可以通过提 issue 方式补充
- 提供额外欺诈信息时，需要提供一定的消息出处

## Thanks

- [telegram-bot-cloudflare](https://github.com/cvzi/telegram-bot-cloudflare)
