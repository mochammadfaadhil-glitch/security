require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

console.log("Bot berjalan...");

// =======================
// ERROR HANDLER
// =======================
bot.on("polling_error", console.error);
process.on("unhandledRejection", console.error);
process.on("uncaughtException", console.error);

// =======================
// CONFIG
// =======================
let ANTI_LINK = true;
let ANTI_SPAM = true;
let ANTI_FORWARD = true;

let DEFAULT_MUTE_DURATION = 5600;

const SPAM_LIMIT = 5;
const TIME_WINDOW = 5000;
const MIN_MUTE_DURATION = 30;

const PROMO_CHANNEL = "https://t.me/aeternummediaa";

// Whitelist channel — forward dari channel ini tidak kena moderasi
const WHITELIST_CHANNELS = [
  "@Ratepapcewek_SDCT", "SeducteaseCH", // ganti/tambah sesuai channel kamu
];

// Blacklist kata — admin & owner tetap bisa
const BLACKLIST_WORDS = ["vcs", "vc", "colmek", "omek", "bokep", "bkp", "okep", "sange", "ange", "vgk"];

const userMessages = {};

let lastWelcomeMessage = {};
const lastWarningMessage = {};

let welcomeLock = {};

const warnCount = {};

// =======================
// ESCAPE MARKDOWN
// =======================
function escapeMarkdown(text) {
  if (!text) return "";
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
}

// =======================
// FORMAT WAKTU WIB
// =======================
function formatDateTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
}

// =======================
// HAPUS PESAN SISTEM OTOMATIS
// =======================
bot.on("message", async (msg) => {

  if (msg.chat.type === "private") return;

  const chatId = msg.chat.id;

  if (
    msg.new_chat_members ||
    msg.left_chat_member ||
    msg.new_chat_title ||
    msg.new_chat_photo ||
    msg.delete_chat_photo ||
    msg.pinned_message ||
    msg.group_chat_created ||
    msg.supergroup_chat_created ||
    msg.channel_chat_created
  ) {
    try {
      await bot.deleteMessage(chatId, msg.message_id);
    } catch {}
  }

});

// =======================
// WELCOME MESSAGE
// =======================
bot.on("message", async (msg) => {

  if (!msg.new_chat_members) return;

  const chatId = msg.chat.id;

  while (welcomeLock[chatId]) {
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  welcomeLock[chatId] = true;

  try {

    const groupName = escapeMarkdown(msg.chat.title);

    for (const member of msg.new_chat_members) {

      const name = escapeMarkdown(member.first_name);

      const mentionUser = member.username
        ? `@${escapeMarkdown(member.username)}`
        : `[${name}](tg://user?id=${member.id})`;

      try {
        if (lastWelcomeMessage[chatId]) {
          await bot.deleteMessage(chatId, lastWelcomeMessage[chatId]);
          lastWelcomeMessage[chatId] = null;
        }
      } catch {}

      const sent = await bot.sendMessage(
        chatId,
`𝐖𝐞𝐥𝐜𝐨𝐦𝐞 ${name} 𝐓𝐨 ${groupName}
User: ${mentionUser}
ID: ${member.id}
JANGAN SPAM & KIRIM LINK SEMBARANGAN`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [
                { text: "ASUPAN FREE", url: PROMO_CHANNEL }
              ],
            ]
          }
        }
      );

      lastWelcomeMessage[chatId] = sent.message_id;

    }

  } finally {
    welcomeLock[chatId] = false;
  }

});

// =======================
// MAIN MODERATION
// =======================
bot.on("message", async (msg) => {

  if (msg.chat.type === "private") return;
  if (!msg.from) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const now = Date.now();

  try {

    const member = await bot.getChatMember(chatId, userId);
    const isAdminOrOwner = ["administrator", "creator"].includes(member.status);

    // ===================
    // ANTI FORWARD
    // ===================

    // Cek apakah forward dari channel yang diwhitelist
    const isFromWhitelistedChannel =
      msg.forward_from_chat &&
      WHITELIST_CHANNELS.includes(
        msg.forward_from_chat.username
          ? "@" + msg.forward_from_chat.username
          : String(msg.forward_from_chat.id)
      );

    if (!isAdminOrOwner && ANTI_FORWARD && (msg.forward_from || msg.forward_from_chat) && !isFromWhitelistedChannel) {

      await bot.deleteMessage(chatId, msg.message_id);

      await muteUser(
        chatId,
        userId,
        msg,
        "Meneruskan pesan tidak diperbolehkan."
      );

      return;
    }

    if (!isAdminOrOwner && msg.text) {

      // ===================
      // ANTI LINK
      // ===================
      if (ANTI_LINK) {

        const linkRegex = /(https?:\/\/|t\.me|www\.)/i;

        if (linkRegex.test(msg.text)) {

          await bot.deleteMessage(chatId, msg.message_id);

          await muteUser(
            chatId,
            userId,
            msg,
            "Mengirim link tidak diperbolehkan."
          );

          return;
        }
      }

      // ===================
      // BLACKLIST KATA
      // ===================
      const textLower = msg.text.toLowerCase();
      const foundWord = BLACKLIST_WORDS.find(word => textLower.includes(word));

      if (foundWord) {
        try {
          await bot.deleteMessage(chatId, msg.message_id);
        } catch {}
        return;
      }

      // ===================
      // ANTI SPAM
      // ===================
      if (ANTI_SPAM) {

        if (!userMessages[userId]) {
          userMessages[userId] = [];
        }

        userMessages[userId].push(now);

        userMessages[userId] = userMessages[userId].filter(
          (time) => now - time < TIME_WINDOW
        );

        if (userMessages[userId].length > SPAM_LIMIT) {

          await muteUser(
            chatId,
            userId,
            msg,
            "Terlalu banyak pesan (spam)."
          );
        }
      }
    }

  } catch (err) {
    console.log("ERROR:", err.response?.body || err.message);
  }

});

// =======================
// MUTE FUNCTION
// =======================
async function muteUser(chatId, userId, msg, reason, customDuration, permanent = false) {

  const duration = customDuration || DEFAULT_MUTE_DURATION;

  if (permanent) {

    await bot.restrictChatMember(chatId, userId, {
      permissions: {
        can_send_messages: false,
        can_send_audios: false,
        can_send_documents: false,
        can_send_photos: false,
        can_send_videos: false,
        can_send_video_notes: false,
        can_send_voice_notes: false,
        can_send_polls: false,
        can_send_other_messages: false,
        can_add_web_page_previews: false,
      }
    });

    const name = escapeMarkdown(msg.from.first_name);

    try {
      if (lastWarningMessage[chatId]) {
        await bot.deleteMessage(chatId, lastWarningMessage[chatId]);
        lastWarningMessage[chatId] = null;
      }
    } catch {}

    const sent = await bot.sendMessage(
      chatId,
`🚫 *PERINGATAN MODERASI*
\`\`\`
User  : ${name}
Muted : PERMANEN
Alasan: ${reason}
\`\`\``,
      { parse_mode: "Markdown" }
    );

    lastWarningMessage[chatId] = sent.message_id;
    return;
  }

  const until = Math.floor(Date.now() / 1000) + duration;

  await bot.restrictChatMember(chatId, userId, {
    permissions: {
      can_send_messages: false,
      can_send_audios: false,
      can_send_documents: false,
      can_send_photos: false,
      can_send_videos: false,
      can_send_video_notes: false,
      can_send_voice_notes: false,
      can_send_polls: false,
      can_send_other_messages: false,
      can_add_web_page_previews: false,
    },
    until_date: until
  });

  const name = escapeMarkdown(msg.from.first_name);
  const untilFormatted = formatDateTime(until * 1000);

  try {
    if (lastWarningMessage[chatId]) {
      await bot.deleteMessage(chatId, lastWarningMessage[chatId]);
      lastWarningMessage[chatId] = null;
    }
  } catch {}

  const sent = await bot.sendMessage(
    chatId,
`🚫 *PERINGATAN MODERASI*
\`\`\`
User  : ${name}
Muted : ${duration} detik
Sampai: ${untilFormatted}
Alasan: ${reason}
\`\`\``,
    { parse_mode: "Markdown" }
  );

  lastWarningMessage[chatId] = sent.message_id;

}

// =======================
// COMMAND .vip
// =======================
bot.onText(/^\.vip$/, async (msg) => {

  const chatId = msg.chat.id;
  const callerId = msg.from.id;

  const callerMember = await bot.getChatMember(chatId, callerId);

  if (!["administrator", "creator"].includes(callerMember.status)) {
    return bot.sendMessage(chatId, "❌ Hanya admin.");
  }

  try { await bot.deleteMessage(chatId, msg.message_id); } catch {}

  bot.sendMessage(chatId,
`𝙑𝙄𝙋 𝙂𝙍𝙐𝙋 AETERNUM

5 rb video
ɪɴᴄʟᴜᴅᴇ ᴘʀᴇᴍɪᴜᴍ ᴠɪᴅᴇᴏ
- KOLEKSI BOWCIL
- ᴄɪᴍᴏʟʟᴀ ғᴜʟʟᴘᴀᴄᴋ ɴᴇᴡ ᴜᴘᴅᴀᴛᴇ
- ᴛᴀʟᴇɴᴛ ᴄᴇᴄᴇ ғᴜʟʟᴘᴀᴄᴋ
- ᴊᴇᴘᴀɴɢ
- ɴᴇᴡ ᴄɪᴘᴀ / ᴄɪʙᴇ ᴠᴇsᴍᴇᴛ
- ᴋᴏʟᴇᴋsɪ ᴊɪʟʙᴀʙ
- ᴅʟʟ.

ONLY 25K

ᴍɪɴᴀᴛ ᴄʜᴀᴛ ᴀᴅᴍɪɴ @aeternum12

testi @testivipaeternum`
  );

});

// =======================
// COMMAND .warn
// =======================
bot.onText(/^\.warn$/, async (msg) => {

  const chatId = msg.chat.id;
  const callerId = msg.from.id;

  const callerMember = await bot.getChatMember(chatId, callerId);
  const callerStatus = callerMember.status;

  if (!["administrator", "creator"].includes(callerStatus)) {
    return bot.sendMessage(chatId, "❌ Hanya admin.");
  }

  if (!msg.reply_to_message) {
    return bot.sendMessage(chatId, "⚠️ Reply pesan user yang ingin diberi warn.");
  }

  const targetId = msg.reply_to_message.from.id;
  const targetMember = await bot.getChatMember(chatId, targetId);
  const targetStatus = targetMember.status;

  if (targetStatus === "creator") {
    return bot.sendMessage(chatId, "❌ Tidak bisa warn owner.");
  }

  if (targetStatus === "administrator" && callerStatus === "creator") {
    return bot.sendMessage(chatId, "Jangan jahat bang 😭🙏");
  }

  if (targetStatus === "administrator" && callerStatus === "administrator") {
    return bot.sendMessage(chatId, "❌ Tidak bisa warn sesama admin.");
  }

  try { await bot.deleteMessage(chatId, msg.message_id); } catch {}
  try { await bot.deleteMessage(chatId, msg.reply_to_message.message_id); } catch {}

  if (!warnCount[chatId]) warnCount[chatId] = {};
  if (!warnCount[chatId][targetId]) warnCount[chatId][targetId] = 0;

  warnCount[chatId][targetId]++;
  const warn = warnCount[chatId][targetId];

  if (warn === 1) {

    await muteUser(chatId, targetId, msg.reply_to_message, "Warn 1 — hati-hati!", 30);

  } else if (warn === 2) {

    await muteUser(chatId, targetId, msg.reply_to_message, "Warn 2 — sekali lagi akan mute permanen!", DEFAULT_MUTE_DURATION);

  } else if (warn >= 3) {

    warnCount[chatId][targetId] = 0;

    await muteUser(chatId, targetId, msg.reply_to_message, "Warn 3 — telah melanggar rules, di-mute permanen.", null, true);

  }

});

// =======================
// COMMAND .setmute
// =======================
bot.onText(/^\.setmute (\d+)$/, async (msg, match) => {

  const chatId = msg.chat.id;
  const callerId = msg.from.id;

  const callerMember = await bot.getChatMember(chatId, callerId);

  if (!["administrator", "creator"].includes(callerMember.status)) {
    return bot.sendMessage(chatId, "❌ Hanya admin.");
  }

  let duration = parseInt(match[1]);

  if (duration < MIN_MUTE_DURATION) {
    return bot.sendMessage(chatId, `❌ Durasi minimum ${MIN_MUTE_DURATION} detik.`);
  }

  DEFAULT_MUTE_DURATION = duration;

  bot.sendMessage(chatId, `✅ Durasi mute default diubah menjadi *${DEFAULT_MUTE_DURATION} detik*`, {
    parse_mode: "Markdown"
  });

});

// =======================
// COMMAND .mute
// Format: .mute <detik> <alasan>
// =======================
bot.onText(/^\.mute (\d+)(?:\s+(.+))?$/, async (msg, match) => {

  const chatId = msg.chat.id;
  const callerId = msg.from.id;

  const callerMember = await bot.getChatMember(chatId, callerId);
  const callerStatus = callerMember.status;

  if (!["administrator", "creator"].includes(callerStatus)) {
    return bot.sendMessage(chatId, "❌ Hanya admin.");
  }

  if (!msg.reply_to_message) {
    return bot.sendMessage(chatId, "⚠️ Reply pesan user yang ingin dimute.");
  }

  const targetId = msg.reply_to_message.from.id;
  const targetMember = await bot.getChatMember(chatId, targetId);
  const targetStatus = targetMember.status;

  if (targetStatus === "creator") {
    return bot.sendMessage(chatId, "❌ Tidak bisa mute owner.");
  }

  if (targetStatus === "administrator" && callerStatus === "creator") {
    return bot.sendMessage(chatId, "Jangan jahat bang 😭🙏");
  }

  if (targetStatus === "administrator" && callerStatus === "administrator") {
    return bot.sendMessage(chatId, "❌ Tidak bisa mute sesama admin.");
  }

  let duration = parseInt(match[1]);
  const alasan = match[2] ? match[2].trim() : "Mute manual oleh admin.";

  if (duration < MIN_MUTE_DURATION) {
    await bot.sendMessage(chatId, `⚠️ Durasi minimum ${MIN_MUTE_DURATION} detik, otomatis diset ${MIN_MUTE_DURATION} detik.`);
    duration = MIN_MUTE_DURATION;
  }

  try { await bot.deleteMessage(chatId, msg.message_id); } catch {}
  try { await bot.deleteMessage(chatId, msg.reply_to_message.message_id); } catch {}

  await muteUser(chatId, targetId, msg.reply_to_message, alasan, duration);

});

// =======================
// COMMAND .kick
// =======================
bot.onText(/^\.kick$/, async (msg) => {

  const chatId = msg.chat.id;
  const callerId = msg.from.id;

  const callerMember = await bot.getChatMember(chatId, callerId);
  const callerStatus = callerMember.status;

  if (!["administrator", "creator"].includes(callerStatus)) {
    return bot.sendMessage(chatId, "❌ Hanya admin.");
  }

  if (!msg.reply_to_message) {
    return bot.sendMessage(chatId, "⚠️ Reply pesan user yang ingin di-kick.");
  }

  const targetId = msg.reply_to_message.from.id;
  const targetMember = await bot.getChatMember(chatId, targetId);
  const targetStatus = targetMember.status;

  if (targetStatus === "creator") {
    return bot.sendMessage(chatId, "❌ Tidak bisa kick owner.");
  }

  if (targetStatus === "administrator" && callerStatus === "creator") {
    return bot.sendMessage(chatId, "Jangan jahat bang 😭🙏");
  }

  if (targetStatus === "administrator" && callerStatus === "administrator") {
    return bot.sendMessage(chatId, "❌ Tidak bisa kick sesama admin.");
  }

  const name = escapeMarkdown(msg.reply_to_message.from.first_name);

  await bot.banChatMember(chatId, targetId);
  await bot.unbanChatMember(chatId, targetId);

  bot.sendMessage(
    chatId,
`✅ *KICK BERHASIL*
\`\`\`
User  : ${name}
Status: Telah dikeluarkan dari grup
\`\`\``,
    { parse_mode: "Markdown" }
  );

});
