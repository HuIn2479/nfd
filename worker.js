// 延迟函数
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
// MarkdownV2 转义函数
function escapeMarkdownV2(text) {
  return String(text).replace(/[\\_\*\[\]\(\)~`>#+\-=|{}\.!]/g, '\\$&');
}
// 获取用户名（优先姓+名，其次 username，其次 first_name，否则未知用户）
function getDisplayName(user) {
  if (user.first_name && user.last_name)
    return user.last_name + " " + user.first_name;
  if (user.username) return user.username;
  if (user.first_name) return user.first_name;
  return "未知用户";
}
const TOKEN = ENV_BOT_TOKEN; // Get it from @BotFather
const WEBHOOK = "/endpoint";
const SECRET = ENV_BOT_SECRET; // A-Z, a-z, 0-9, _ and -
const ADMIN_UID = ENV_ADMIN_UID; // your user id, get it from https://t.me/username_to_id_bot

const NOTIFY_INTERVAL = 3600 * 1000;
const fraudDb =
  "https://raw.githubusercontent.com/HuIn2479/nfd/main/data/fraud.db";
const notificationUrl =
  "https://raw.githubusercontent.com/HuIn2479/nfd/main/data/notification.txt";
const startMsgUrl =
  "https://raw.githubusercontent.com/HuIn2479/nfd/main/data/startMessage.md";

const enable_notification = true;
/**
 * Return url to telegram api, optionally with parameters added
 */
function apiUrl(methodName, params = null) {
  let query = "";
  if (params) {
    query = "?" + new URLSearchParams(params).toString();
  }
  return `https://api.telegram.org/bot${TOKEN}/${methodName}${query}`;
}

function requestTelegram(methodName, body, params = null) {
  return fetch(apiUrl(methodName, params), body).then((r) => r.json());
}

function makeReqBody(body) {
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  };
}

function sendMessage(msg = {}, parseMode = "MarkdownV2") {
  if (parseMode) msg.parse_mode = parseMode;
  return requestTelegram("sendMessage", makeReqBody(msg));
}

function copyMessage(msg = {}) {
  return requestTelegram("copyMessage", makeReqBody(msg));
}

function forwardMessage(msg) {
  return requestTelegram("forwardMessage", makeReqBody(msg));
}

/**
 * Wait for requests to the worker
 */
addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname === WEBHOOK) {
    event.respondWith(handleWebhook(event));
  } else if (url.pathname === "/registerWebhook") {
    event.respondWith(registerWebhook(event, url, WEBHOOK, SECRET));
  } else if (url.pathname === "/unRegisterWebhook") {
    event.respondWith(unRegisterWebhook(event));
  } else {
    event.respondWith(new Response("No handler for this request"));
  }
});

/**
 * Handle requests to WEBHOOK
 * https://core.telegram.org/bots/api#update
 */
async function handleWebhook(event) {
  // Check secret
  if (event.request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== SECRET) {
    return new Response("Unauthorized", { status: 403 });
  }

  // Read request body synchronously
  const update = await event.request.json();
  // Deal with response asynchronously
  event.waitUntil(onUpdate(update));

  return new Response("Ok");
}

/**
 * Handle incoming Update
 * https://core.telegram.org/bots/api#update
 */
async function onUpdate(update) {
  if ("message" in update) {
    await onMessage(update.message);
  }
}

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
    const userLink = message.from.username ? 
      `https://t.me/${message.from.username}` : 
      `tg://user?id=${userId}`;
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
      return checkBlockById(match[1].trim());
    }
    if (/^\/block\s+(.+)/.test(message.text)) {
      const match = message.text.match(/^\/block\s+(.+)/);
      return handleBlockById(match[1].trim());
    }
    if (/^\/unblock\s+(.+)/.test(message.text)) {
      const match = message.text.match(/^\/unblock\s+(.+)/);
      return handleUnBlockById(match[1].trim());
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
  if (message.text && message.text.startsWith('/')) {
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
      await requestTelegram('deleteMessage', makeReqBody({
        chat_id: chatId,
        message_id: tipMsg.result.message_id
      }));
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

async function handleNotify(message) {
  // 先判断是否是诈骗人员，如果是，则直接提醒
  // 如果不是，则根据时间间隔提醒：用户id，交易注意点等
  let chatId = message.chat.id;
  if (await isFraud(chatId)) {
    return sendMessage(
      {
        chat_id: ADMIN_UID,
        text: `检测到骗子，UID:\`${escapeMarkdownV2(chatId)}\``,
      },
      "MarkdownV2"
    );
  }
  if (enable_notification) {
    let lastMsgTime = await nfd.get("lastmsg-" + chatId, { type: "json" });
    if (!lastMsgTime || Date.now() - lastMsgTime > NOTIFY_INTERVAL) {
      await nfd.put("lastmsg-" + chatId, Date.now());
      // 获取用户信息
      const username = getDisplayName(message.from);
      const userId = message.from.id;
      const language = message.from.language_code || '未知';
      // 获取或设置首次使用时间
      let firstSeen = await nfd.get(`first-seen-${chatId}`, { type: "json" });
      if (!firstSeen) {
        firstSeen = Date.now();
        await nfd.put(`first-seen-${chatId}`, firstSeen);
      }
      // 获取消息计数
      let messageCount = await nfd.get(`msg-count-${chatId}`, { type: "json" }) || 0;
      messageCount++;
      await nfd.put(`msg-count-${chatId}`, messageCount);
      // 格式化时间
      const formatTime = (timestamp) => new Date(timestamp).toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai'
      });
      let notifyText = await fetch(notificationUrl).then((r) => r.text());
      notifyText = notifyText
        .replace("{{username}}", escapeMarkdownV2(username))
        .replace("{{user_id}}", escapeMarkdownV2(userId.toString()))
        .replace("{{language}}", escapeMarkdownV2(language))
        .replace("{{first_seen}}", escapeMarkdownV2(formatTime(firstSeen)))
        .replace("{{message_count}}", escapeMarkdownV2(messageCount.toString()))
        .replace("{{last_active}}", escapeMarkdownV2(formatTime(Date.now())));
      return sendMessage(
        {
          chat_id: ADMIN_UID,
          text: notifyText,
        },
        "MarkdownV2"
      );
    }
  }
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
      text: `UID:\`${escapeMarkdownV2(guestChantId)}\`` + (blocked ? " 被屏蔽" : " 没有被屏蔽"),
    },
    "MarkdownV2"
  );
}

async function checkBlockById(userId) {
  let blocked = await nfd.get("isblocked-" + userId, { type: "json" });

  return sendMessage(
    {
      chat_id: ADMIN_UID,
      text: `UID:\`${escapeMarkdownV2(userId)}\`` + (blocked ? " 被屏蔽" : " 没有被屏蔽"),
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

async function isFraud(id) {
  id = id.toString();
  let db = await fetch(fraudDb).then((r) => r.text());
  let arr = db.split("\n").filter((v) => v);
  console.log(JSON.stringify(arr));
  let flag = arr.filter((v) => v === id).length !== 0;
  console.log(flag);
  return flag;
}
