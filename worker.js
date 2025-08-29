// ===== Telegram Bot NFD Worker =====
// Cloudflare Workers 机器人用于消息转发和用户管理

// ===== 工具函数模块 =====
const Utils = {
  /**
   * 延迟函数
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  },

  /**
   * MarkdownV2 转义函数
   */
  escapeMarkdownV2(text) {
    return String(text).replace(/[\\_\*\[\]\(\)~`>#+\-=|{}\.!]/g, "\\$&");
  },

  /**
   * 验证用户ID是否为纯数字
   */
  isValidUserId(userId) {
    return /^\d+$/.test(userId.toString().trim());
  },

  /**
   * 获取用户显示名称（优先姓+名，其次 username，最后 first_name）
   */
  getDisplayName(user) {
    if (user.first_name && user.last_name) {
      return `${user.last_name} ${user.first_name}`;
    }
    if (user.username) return user.username;
    if (user.first_name) return user.first_name;
    return "未知用户";
  },

  /**
   * 格式化时间（上海时区）
   */
  formatTime(timestamp) {
    return new Date(timestamp).toLocaleString("zh-CN", {
      timeZone: "Asia/Shanghai",
    });
  },

  /**
   * 生成用户链接
   */
  generateUserLink(user) {
    return user.username
      ? `https://t.me/${user.username}`
      : `tg://user?id=${user.id}`;
  },
};

// ===== 配置常量 =====
const Config = {
  TOKEN: ENV_BOT_TOKEN, // Get it from @BotFather
  WEBHOOK: "/endpoint",
  SECRET: ENV_BOT_SECRET, // A-Z, a-z, 0-9, _ and -
  ADMIN_UID: ENV_ADMIN_UID, // your user id, get it from https://t.me/username_to_id_bot

  NOTIFY_INTERVAL: 3600 * 1000,
  URLS: {
    fraudDb:
      "https://raw.githubusercontent.com/HuIn2479/nfd/main/data/fraud.db",
    notification:
      "https://raw.githubusercontent.com/HuIn2479/nfd/main/data/notification.md",
    startMessage:
      "https://raw.githubusercontent.com/HuIn2479/nfd/main/data/startMessage.md",
  },

  enable_notification: true,
};

// ===== Telegram API 模块 =====
const TelegramAPI = {
  /**
   * 构建 Telegram API URL
   */
  apiUrl(methodName, params = null) {
    const query = params ? `?${new URLSearchParams(params).toString()}` : "";
    return `https://api.telegram.org/bot${Config.TOKEN}/${methodName}${query}`;
  },

  /**
   * 请求 Telegram API
   */
  async request(methodName, body, params = null) {
    return fetch(this.apiUrl(methodName, params), body).then((r) => r.json());
  },

  /**
   * 创建请求体
   */
  makeReqBody(body) {
    return {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    };
  },

  /**
   * 发送消息（默认 MarkdownV2 格式）
   */
  sendMessage(msg = {}, parseMode = "MarkdownV2") {
    if (parseMode) msg.parse_mode = parseMode;
    return this.request("sendMessage", this.makeReqBody(msg));
  },

  /**
   * 复制消息
   */
  copyMessage(msg = {}) {
    return this.request("copyMessage", this.makeReqBody(msg));
  },

  /**
   * 转发消息
   */
  forwardMessage(msg) {
    return this.request("forwardMessage", this.makeReqBody(msg));
  },

  /**
   * 删除消息
   */
  deleteMessage(chatId, messageId) {
    return this.request(
      "deleteMessage",
      this.makeReqBody({
        chat_id: chatId,
        message_id: messageId,
      })
    );
  },
};

// ===== 事件监听器 =====
addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname === Config.WEBHOOK) {
    event.respondWith(WebhookHandler.handle(event));
  } else if (url.pathname === "/registerWebhook") {
    event.respondWith(WebhookHandler.register(event, url));
  } else if (url.pathname === "/unRegisterWebhook") {
    event.respondWith(WebhookHandler.unregister(event));
  } else {
    event.respondWith(new Response("No handler for this request"));
  }
});

// ===== Webhook 处理模块 =====
const WebhookHandler = {
  /**
   * 处理 WEBHOOK 请求
   */
  async handle(event) {
    // Check secret
    if (
      event.request.headers.get("X-Telegram-Bot-Api-Secret-Token") !==
      Config.SECRET
    ) {
      return new Response("Unauthorized", { status: 403 });
    }

    // Read request body synchronously
    const update = await event.request.json();
    // Deal with response asynchronously
    event.waitUntil(this.onUpdate(update));

    return new Response("Ok");
  },

  /**
   * Handle incoming Update
   */
  async onUpdate(update) {
    if ("message" in update) {
      await MessageHandler.process(update.message);
    }
  },

  /**
   * Set webhook to this worker's url
   */
  async register(event, requestUrl) {
    const webhookUrl = `${requestUrl.protocol}//${requestUrl.hostname}${Config.WEBHOOK}`;
    const r = await (
      await fetch(
        TelegramAPI.apiUrl("setWebhook", {
          url: webhookUrl,
          secret_token: Config.SECRET,
        })
      )
    ).json();
    return new Response("ok" in r && r.ok ? "Ok" : JSON.stringify(r, null, 2));
  },

  /**
   * Remove webhook
   */
  async unregister(event) {
    const r = await (
      await fetch(TelegramAPI.apiUrl("setWebhook", { url: "" }))
    ).json();
    return new Response("ok" in r && r.ok ? "Ok" : JSON.stringify(r, null, 2));
  },
};

// ===== 消息处理模块 =====
const MessageHandler = {
  /**
   * 处理传入的消息
   */
  async process(message) {
    if (message.text === "/start") {
      return this.handleStart(message);
    }

    if (message.chat.id.toString() === Config.ADMIN_UID) {
      return this.handleAdminMessage(message);
    }

    return this.handleGuestMessage(message);
  },

  /**
   * 处理 /start 命令
   */
  async handleStart(message) {
    const userId = message.from.id;
    const username = Utils.getDisplayName(message.from);
    let startMsg = await fetch(Config.URLS.startMessage).then((r) => r.text());

    // 动态生成用户链接
    const userLink = Utils.generateUserLink(message.from);
    startMsg = startMsg
      .replace("{{username}}", Utils.escapeMarkdownV2(username))
      .replace("{{user_id}}", Utils.escapeMarkdownV2(userId))
      .replace("{{user_link}}", userLink);

    const keyboard = {
      inline_keyboard: [
        [{ text: "〇Enshō🌸", url: "https://ns.onedays.top/" }],
      ],
    };

    return TelegramAPI.sendMessage({
      chat_id: message.chat.id,
      text: startMsg,
      reply_markup: keyboard,
    });
  },

  /**
   * 处理管理员消息
   */
  async handleAdminMessage(message) {
    // 处理带参数的命令
    const commandHandlers = [
      {
        pattern: /^\/checkblock\s+(.+)/,
        handler: (match) => AdminCommands.checkBlockById(match[1].trim()),
      },
      {
        pattern: /^\/block\s+(.+)/,
        handler: (match) => AdminCommands.blockById(match[1].trim()),
      },
      {
        pattern: /^\/unblock\s+(.+)/,
        handler: (match) => AdminCommands.unblockById(match[1].trim()),
      },
    ];

    for (const { pattern, handler } of commandHandlers) {
      const match = message.text?.match(pattern);
      if (match) {
        const userId = match[1].trim();
        if (!Utils.isValidUserId(userId)) {
          return TelegramAPI.sendMessage({
            chat_id: Config.ADMIN_UID,
            text: "用户ID必须为纯数字",
          });
        }
        return handler(match);
      }
    }

    // 检查是否有回复消息
    if (!message?.reply_to_message?.chat) {
      return TelegramAPI.sendMessage({
        chat_id: Config.ADMIN_UID,
        text: "使用方法，回复转发的消息，并发送回复消息，或者`/block`、`/unblock`、`/checkblock`等指令",
      });
    }

    // 处理无参数的命令
    const replyCommands = {
      "/block": AdminCommands.block,
      "/unblock": AdminCommands.unblock,
      "/checkblock": AdminCommands.checkBlock,
    };

    if (replyCommands[message.text]) {
      return replyCommands[message.text](message);
    }

    // 转发消息给对应用户
    const guestChatId = await nfd.get(
      "msg-map-" + message?.reply_to_message.message_id,
      { type: "json" }
    );

    return TelegramAPI.copyMessage({
      chat_id: guestChatId,
      from_chat_id: message.chat.id,
      message_id: message.message_id,
    });
  },

  /**
   * 处理访客消息
   */
  async handleGuestMessage(message) {
    const chatId = message.chat.id;

    // 检测用户是否输入了指令
    if (message.text && message.text.startsWith("/")) {
      return TelegramAPI.sendMessage({
        chat_id: chatId,
        text: Utils.escapeMarkdownV2("⚠️ 你不许发（哈气）"),
      });
    }

    // 检查是否被屏蔽
    const isBlocked = await nfd.get("isblocked-" + chatId, { type: "json" });
    if (isBlocked) {
      return TelegramAPI.sendMessage({
        chat_id: chatId,
        text: Utils.escapeMarkdownV2("You are blocked"),
      });
    }

    // 防刷机制
    await this.sendReceiptMessage(chatId);

    // 转发消息给管理员
    const forwardReq = await TelegramAPI.forwardMessage({
      chat_id: Config.ADMIN_UID,
      from_chat_id: message.chat.id,
      message_id: message.message_id,
    });

    console.log(JSON.stringify(forwardReq));
    if (forwardReq.ok) {
      await nfd.put("msg-map-" + forwardReq.result.message_id, chatId);
    }

    return NotificationService.notify(message);
  },

  /**
   * 发送收到消息的确认
   */
  async sendReceiptMessage(chatId) {
    const tipKey = `last-tip-${chatId}`;
    const tipInterval = 10 * 1000; // 10秒内只发一次
    const lastTip = await nfd.get(tipKey, { type: "json" });

    if (!lastTip || Date.now() - lastTip > tipInterval) {
      const tipMsg = await TelegramAPI.sendMessage({
        chat_id: chatId,
        text: Utils.escapeMarkdownV2("✉️ 收到了喵！会尽快回复的喵~"),
      });

      await nfd.put(tipKey, Date.now());

      // 自动撤回
      if (tipMsg && tipMsg.result && tipMsg.result.message_id) {
        await Utils.sleep(10000);
        await TelegramAPI.deleteMessage(chatId, tipMsg.result.message_id);
      }
    }
  },
};

/**
 * Handle incoming Message
 * https://core.telegram.org/bots/api#message
 */
async function onMessage(message) {
  if (message.text === "/start") {
    const userId = message.from.id;
    const username = getDisplayName(message.from);
    let startMsg = await fetch(startMsgUrl).then((r) => r.text());
    // 动态生成用户链接：有用户名用 t.me/username，没有用 tg://user?id=
    const userLink = message.from.username
      ? `https://t.me/${message.from.username}`
      : `tg://user?id=${userId}`;
    startMsg = startMsg
      .replace("{{username}}", escapeMarkdownV2(username))
      .replace("{{user_id}}", escapeMarkdownV2(userId))
      .replace("{{user_link}}", userLink);
    const keyboard = {
      inline_keyboard: [
        [{ text: "〇Enshō🌸", url: "https://ns.onedays.top/" }],
      ],
    };
    return sendMessage(
      {
        chat_id: message.chat.id,
        text: startMsg,
        reply_markup: keyboard,
      },
      "MarkdownV2"
    );
  }
  if (message.chat.id.toString() === ADMIN_UID) {
    if (/^\/checkblock\s+(.+)/.test(message.text)) {
      const match = message.text.match(/^\/checkblock\s+(.+)/);
      const userId = match[1].trim();
      if (!isValidUserId(userId)) {
        return sendMessage({
          chat_id: ADMIN_UID,
          text: "用户ID必须为纯数字",
        });
      }
      return checkBlockById(userId);
    }
    if (/^\/block\s+(.+)/.test(message.text)) {
      const match = message.text.match(/^\/block\s+(.+)/);
      const userId = match[1].trim();
      if (!isValidUserId(userId)) {
        return sendMessage({
          chat_id: ADMIN_UID,
          text: "用户ID必须为纯数字",
        });
      }
      return handleBlockById(userId);
    }
    if (/^\/unblock\s+(.+)/.test(message.text)) {
      const match = message.text.match(/^\/unblock\s+(.+)/);
      const userId = match[1].trim();
      if (!isValidUserId(userId)) {
        return sendMessage({
          chat_id: ADMIN_UID,
          text: "用户ID必须为纯数字",
        });
      }
      return handleUnBlockById(userId);
    }
    if (!message?.reply_to_message?.chat) {
      return sendMessage(
        {
          chat_id: ADMIN_UID,
          text: "使用方法，回复转发的消息，并发送回复消息，或者`/block`、`/unblock`、`/checkblock`等指令",
        },
        "MarkdownV2"
      );
    }
    if (/^\/block$/.exec(message.text)) {
      return handleBlock(message);
    }
    if (/^\/unblock$/.exec(message.text)) {
      return handleUnBlock(message);
    }
    if (/^\/checkblock$/.exec(message.text)) {
      return checkBlock(message);
    }
    let guestChantId = await nfd.get(
      "msg-map-" + message?.reply_to_message.message_id,
      { type: "json" }
    );
    return copyMessage({
      chat_id: guestChantId,
      from_chat_id: message.chat.id,
      message_id: message.message_id,
    });
  }
  return handleGuestMessage(message);
}

async function handleGuestMessage(message) {
  let chatId = message.chat.id;
  // 检测用户是否输入了指令
  if (message.text && message.text.startsWith("/")) {
    return sendMessage({
      chat_id: chatId,
      text: escapeMarkdownV2("⚠️ 你不许发（哈气）"),
    });
  }
  let isblocked = await nfd.get("isblocked-" + chatId, { type: "json" });
  if (isblocked) {
    return sendMessage(
      {
        chat_id: chatId,
        text: escapeMarkdownV2("You are blocked"),
      },
      "MarkdownV2"
    );
  }

  // 防刷：短时间内只发一条“消息已送达”,并自动撤回
  const tipKey = `last-tip-${chatId}`;
  const tipInterval = 10 * 1000; // 10秒内只发一次
  let lastTip = await nfd.get(tipKey, { type: "json" });
  if (!lastTip || Date.now() - lastTip > tipInterval) {
    const tipMsg = await sendMessage({
      chat_id: chatId,
      text: escapeMarkdownV2("✉️ 收到了喵！会尽快回复的喵~"),
    });
    await nfd.put(tipKey, Date.now());
    // 自动撤回
    if (tipMsg && tipMsg.result && tipMsg.result.message_id) {
      await sleep(10000);
      await requestTelegram(
        "deleteMessage",
        makeReqBody({
          chat_id: chatId,
          message_id: tipMsg.result.message_id,
        })
      );
    }
  }

  let forwardReq = await forwardMessage({
    chat_id: ADMIN_UID,
    from_chat_id: message.chat.id,
    message_id: message.message_id,
  });
  console.log(JSON.stringify(forwardReq));
  if (forwardReq.ok) {
    await nfd.put("msg-map-" + forwardReq.result.message_id, chatId);
  }
  return handleNotify(message);
}

// ===== 通知和用户管理 =====
/**
 * 处理通知逻辑
 */
async function handleNotify(message) {
  const chatId = message.chat.id;
  // 检查是否为诈骗用户
  if (await isFraud(chatId)) {
    return sendMessage({
      chat_id: ADMIN_UID,
      text: `检测到骗子，UID:\`${escapeMarkdownV2(chatId.toString())}\``,
    });
  }
  // 发送用户信息通知
  if (enable_notification) {
    const lastMsgTime = await nfd.get(`lastmsg-${chatId}`, { type: "json" });
    if (!lastMsgTime || Date.now() - lastMsgTime > NOTIFY_INTERVAL) {
      await nfd.put(`lastmsg-${chatId}`, Date.now());
      // 收集用户信息
      const userInfo = await collectUserInfo(message);
      // 生成并发送通知
      let notifyText = await fetch(notificationUrl).then((r) => r.text());
      notifyText = replaceUserInfoPlaceholders(notifyText, userInfo);
      return sendMessage({
        chat_id: ADMIN_UID,
        text: notifyText,
      });
    }
  }
}

/**
 * 收集用户信息
 */
async function collectUserInfo(message) {
  const chatId = message.chat.id;
  const username = getDisplayName(message.from);
  const userId = message.from.id;
  const language = message.from.language_code || "未知";
  // 获取或设置首次使用时间
  let firstSeen = await nfd.get(`first-seen-${chatId}`, { type: "json" });
  if (!firstSeen) {
    firstSeen = Date.now();
    await nfd.put(`first-seen-${chatId}`, firstSeen);
  }
  // 获取并更新消息计数
  let messageCount =
    (await nfd.get(`msg-count-${chatId}`, { type: "json" })) || 0;
  messageCount++;
  await nfd.put(`msg-count-${chatId}`, messageCount);
  return {
    username,
    userId: userId.toString(),
    language,
    firstSeen: formatTime(firstSeen),
    messageCount: messageCount.toString(),
    lastActive: formatTime(Date.now()),
  };
}

/**
 * 替换用户信息占位符
 */
function replaceUserInfoPlaceholders(text, userInfo) {
  return text
    .replace("{{username}}", escapeMarkdownV2(userInfo.username))
    .replace("{{user_id}}", escapeMarkdownV2(userInfo.userId))
    .replace("{{language}}", escapeMarkdownV2(userInfo.language))
    .replace("{{first_seen}}", escapeMarkdownV2(userInfo.firstSeen))
    .replace("{{message_count}}", escapeMarkdownV2(userInfo.messageCount))
    .replace("{{last_active}}", escapeMarkdownV2(userInfo.lastActive));
}

async function handleBlock(message) {
  let guestChantId = await nfd.get(
    "msg-map-" + message.reply_to_message.message_id,
    { type: "json" }
  );
  if (guestChantId === ADMIN_UID) {
    return sendMessage(
      {
        chat_id: ADMIN_UID,
        text: "不能屏蔽自己",
      },
      "MarkdownV2"
    );
  }
  await nfd.put("isblocked-" + guestChantId, true);

  return sendMessage(
    {
      chat_id: ADMIN_UID,
      text: `UID:\`${escapeMarkdownV2(guestChantId)}\` 屏蔽成功`,
    },
    "MarkdownV2"
  );
}

async function handleUnBlock(message) {
  let guestChantId = await nfd.get(
    "msg-map-" + message.reply_to_message.message_id,
    { type: "json" }
  );
  await nfd.put("isblocked-" + guestChantId, false);
  return sendMessage(
    {
      chat_id: ADMIN_UID,
      text: `UID:\`${escapeMarkdownV2(guestChantId)}\` 解除屏蔽成功`,
    },
    "MarkdownV2"
  );
}

async function checkBlock(message) {
  let guestChantId = await nfd.get(
    "msg-map-" + message.reply_to_message.message_id,
    { type: "json" }
  );
  let blocked = await nfd.get("isblocked-" + guestChantId, { type: "json" });

  return sendMessage(
    {
      chat_id: ADMIN_UID,
      text:
        `UID:\`${escapeMarkdownV2(guestChantId)}\`` +
        (blocked ? " 被屏蔽" : " 没有被屏蔽"),
    },
    "MarkdownV2"
  );
}

async function checkBlockById(userId) {
  let blocked = await nfd.get("isblocked-" + userId, { type: "json" });

  return sendMessage(
    {
      chat_id: ADMIN_UID,
      text:
        `UID:\`${escapeMarkdownV2(userId)}\`` +
        (blocked ? " 被屏蔽" : " 没有被屏蔽"),
    },
    "MarkdownV2"
  );
}

async function handleBlockById(userId) {
  if (userId === ADMIN_UID) {
    return sendMessage(
      {
        chat_id: ADMIN_UID,
        text: "不能屏蔽自己",
      },
      "MarkdownV2"
    );
  }
  await nfd.put("isblocked-" + userId, true);

  return sendMessage(
    {
      chat_id: ADMIN_UID,
      text: `UID:\`${escapeMarkdownV2(userId)}\` 屏蔽成功`,
    },
    "MarkdownV2"
  );
}

async function handleUnBlockById(userId) {
  await nfd.put("isblocked-" + userId, false);

  return sendMessage(
    {
      chat_id: ADMIN_UID,
      text: `UID:\`${escapeMarkdownV2(userId)}\` 解除屏蔽成功`,
    },
    "MarkdownV2"
  );
}

/**
 * Send plain text message
 * https://core.telegram.org/bots/api#sendmessage
 */
async function sendPlainText(chatId, text, parseMode = "MarkdownV2") {
  return sendMessage(
    {
      chat_id: chatId,
      text,
    },
    "MarkdownV2"
  );
}

/**
 * Set webhook to this worker's url
 * https://core.telegram.org/bots/api#setwebhook
 */
async function registerWebhook(event, requestUrl, suffix, secret) {
  // https://core.telegram.org/bots/api#setwebhook
  const webhookUrl = `${requestUrl.protocol}//${requestUrl.hostname}${suffix}`;
  const r = await (
    await fetch(apiUrl("setWebhook", { url: webhookUrl, secret_token: secret }))
  ).json();
  return new Response("ok" in r && r.ok ? "Ok" : JSON.stringify(r, null, 2));
}

/**
 * Remove webhook
 * https://core.telegram.org/bots/api#setwebhook
 */
async function unRegisterWebhook(event) {
  const r = await (await fetch(apiUrl("setWebhook", { url: "" }))).json();
  return new Response("ok" in r && r.ok ? "Ok" : JSON.stringify(r, null, 2));
}

// ===== 防诈骗系统 =====
/**
 * 检查用户是否为诈骗者
 */
async function isFraud(id) {
  id = id.toString();
  let db = await fetch(fraudDb).then((r) => r.text());
  let arr = db.split("\n").filter((v) => v);
  console.log(JSON.stringify(arr));
  let flag = arr.filter((v) => v === id).length !== 0;
  console.log(flag);
  return flag;
}

/**
 * 阻止用户（添加到诈骗列表）
 */
async function blockUser(userId) {
  const fraudUsers = (await nfd.get("fraud_users", { type: "json" })) || [];
  if (!fraudUsers.includes(userId.toString())) {
    fraudUsers.push(userId.toString());
    await nfd.put("fraud_users", fraudUsers);
  }
}

/**
 * 解除阻止用户（从诈骗列表移除）
 */
async function unblockUser(userId) {
  const fraudUsers = (await nfd.get("fraud_users", { type: "json" })) || [];
  const updatedList = fraudUsers.filter((id) => id !== userId.toString());
  await nfd.put("fraud_users", updatedList);
}

/**
 * 获取阻止列表
 */
async function getBlockedUsers() {
  return (await nfd.get("fraud_users", { type: "json" })) || [];
}

// ===== 通知服务模块 =====
const NotificationService = {
  /**
   * 处理通知逻辑
   */
  async notify(message) {
    const chatId = message.chat.id;

    // 检查是否为诈骗用户
    if (await FraudDetection.isFraud(chatId)) {
      return TelegramAPI.sendMessage({
        chat_id: Config.ADMIN_UID,
        text: `检测到骗子，UID:\`${Utils.escapeMarkdownV2(
          chatId.toString()
        )}\``,
      });
    }

    // 发送用户信息通知
    if (Config.enable_notification) {
      const lastMsgTime = await nfd.get(`lastmsg-${chatId}`, { type: "json" });

      if (!lastMsgTime || Date.now() - lastMsgTime > Config.NOTIFY_INTERVAL) {
        await nfd.put(`lastmsg-${chatId}`, Date.now());

        // 收集用户信息
        const userInfo = await this.collectUserInfo(message);

        // 生成并发送通知
        let notifyText = await fetch(Config.URLS.notification).then((r) =>
          r.text()
        );
        notifyText = this.replaceUserInfoPlaceholders(notifyText, userInfo);

        return TelegramAPI.sendMessage({
          chat_id: Config.ADMIN_UID,
          text: notifyText,
        });
      }
    }
  },

  /**
   * 收集用户信息
   */
  async collectUserInfo(message) {
    const chatId = message.chat.id;
    const username = Utils.getDisplayName(message.from);
    const userId = message.from.id;
    const language = message.from.language_code || "未知";

    // 获取或设置首次使用时间
    let firstSeen = await nfd.get(`first-seen-${chatId}`, { type: "json" });
    if (!firstSeen) {
      firstSeen = Date.now();
      await nfd.put(`first-seen-${chatId}`, firstSeen);
    }

    // 获取并更新消息计数
    let messageCount =
      (await nfd.get(`msg-count-${chatId}`, { type: "json" })) || 0;
    messageCount++;
    await nfd.put(`msg-count-${chatId}`, messageCount);

    return {
      username,
      userId: userId.toString(),
      language,
      firstSeen: Utils.formatTime(firstSeen),
      messageCount: messageCount.toString(),
      lastActive: Utils.formatTime(Date.now()),
    };
  },

  /**
   * 替换用户信息占位符
   */
  replaceUserInfoPlaceholders(text, userInfo) {
    return text
      .replace("{{username}}", Utils.escapeMarkdownV2(userInfo.username))
      .replace("{{user_id}}", Utils.escapeMarkdownV2(userInfo.userId))
      .replace("{{language}}", Utils.escapeMarkdownV2(userInfo.language))
      .replace("{{first_seen}}", Utils.escapeMarkdownV2(userInfo.firstSeen))
      .replace(
        "{{message_count}}",
        Utils.escapeMarkdownV2(userInfo.messageCount)
      )
      .replace("{{last_active}}", Utils.escapeMarkdownV2(userInfo.lastActive));
  },
};

// ===== 管理员命令模块 =====
const AdminCommands = {
  /**
   * 通过回复消息屏蔽用户
   */
  async block(message) {
    const guestChatId = await nfd.get(
      "msg-map-" + message.reply_to_message.message_id,
      { type: "json" }
    );

    if (guestChatId === Config.ADMIN_UID) {
      return TelegramAPI.sendMessage({
        chat_id: Config.ADMIN_UID,
        text: "不能屏蔽自己",
      });
    }

    await nfd.put("isblocked-" + guestChatId, true);

    return TelegramAPI.sendMessage({
      chat_id: Config.ADMIN_UID,
      text: `UID:\`${Utils.escapeMarkdownV2(guestChatId)}\` 屏蔽成功`,
    });
  },

  /**
   * 通过回复消息解除屏蔽用户
   */
  async unblock(message) {
    const guestChatId = await nfd.get(
      "msg-map-" + message.reply_to_message.message_id,
      { type: "json" }
    );

    await nfd.put("isblocked-" + guestChatId, false);

    return TelegramAPI.sendMessage({
      chat_id: Config.ADMIN_UID,
      text: `UID:\`${Utils.escapeMarkdownV2(guestChatId)}\` 解除屏蔽成功`,
    });
  },

  /**
   * 通过回复消息检查屏蔽状态
   */
  async checkBlock(message) {
    const guestChatId = await nfd.get(
      "msg-map-" + message.reply_to_message.message_id,
      { type: "json" }
    );

    const blocked = await nfd.get("isblocked-" + guestChatId, { type: "json" });

    return TelegramAPI.sendMessage({
      chat_id: Config.ADMIN_UID,
      text:
        `UID:\`${Utils.escapeMarkdownV2(guestChatId)}\`` +
        (blocked ? " 被屏蔽" : " 没有被屏蔽"),
    });
  },

  /**
   * 通过ID检查屏蔽状态
   */
  async checkBlockById(userId) {
    const blocked = await nfd.get("isblocked-" + userId, { type: "json" });

    return TelegramAPI.sendMessage({
      chat_id: Config.ADMIN_UID,
      text:
        `UID:\`${Utils.escapeMarkdownV2(userId)}\`` +
        (blocked ? " 被屏蔽" : " 没有被屏蔽"),
    });
  },

  /**
   * 通过ID屏蔽用户
   */
  async blockById(userId) {
    if (userId === Config.ADMIN_UID) {
      return TelegramAPI.sendMessage({
        chat_id: Config.ADMIN_UID,
        text: "不能屏蔽自己",
      });
    }

    await nfd.put("isblocked-" + userId, true);

    return TelegramAPI.sendMessage({
      chat_id: Config.ADMIN_UID,
      text: `UID:\`${Utils.escapeMarkdownV2(userId)}\` 屏蔽成功`,
    });
  },

  /**
   * 通过ID解除屏蔽用户
   */
  async unblockById(userId) {
    await nfd.put("isblocked-" + userId, false);

    return TelegramAPI.sendMessage({
      chat_id: Config.ADMIN_UID,
      text: `UID:\`${Utils.escapeMarkdownV2(userId)}\` 解除屏蔽成功`,
    });
  },
};

// ===== 防诈骗检测模块 =====
const FraudDetection = {
  /**
   * 检查用户是否为诈骗者
   */
  async isFraud(id) {
    id = id.toString();
    const db = await fetch(Config.URLS.fraudDb).then((r) => r.text());
    const arr = db.split("\n").filter((v) => v);
    console.log(JSON.stringify(arr));
    const flag = arr.filter((v) => v === id).length !== 0;
    console.log(flag);
    return flag;
  },

  /**
   * 阻止用户（添加到诈骗列表）
   */
  async blockUser(userId) {
    const fraudUsers = (await nfd.get("fraud_users", { type: "json" })) || [];
    if (!fraudUsers.includes(userId.toString())) {
      fraudUsers.push(userId.toString());
      await nfd.put("fraud_users", fraudUsers);
    }
  },

  /**
   * 解除阻止用户（从诈骗列表移除）
   */
  async unblockUser(userId) {
    const fraudUsers = (await nfd.get("fraud_users", { type: "json" })) || [];
    const updatedList = fraudUsers.filter((id) => id !== userId.toString());
    await nfd.put("fraud_users", updatedList);
  },

  /**
   * 获取阻止列表
   */
  async getBlockedUsers() {
    return (await nfd.get("fraud_users", { type: "json" })) || [];
  },
};
