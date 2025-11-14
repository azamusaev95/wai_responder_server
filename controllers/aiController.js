import axios from "axios";
import User from "../models/User.js";

function clamp(v, lo, hi) {
  if (typeof v !== "number" || Number.isNaN(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
}

function formatCatalog(items = []) {
  try {
    const arr = (Array.isArray(items) ? items : []).slice(0, 100).map((x) => ({
      name: String(x.name ?? "").slice(0, 64),
      description: String(x.description ?? "").slice(0, 240),
      price: Number.isFinite(+x.price) ? +x.price : undefined,
    }));
    return JSON.stringify(arr);
  } catch {
    return "[]";
  }
}

// Проверка активности подписки
const isSubscriptionActive = (user) => {
  if (!user.isPro) return false;
  if (!user.subscriptionExpires) return true;
  return new Date() < new Date(user.subscriptionExpires);
};

// Обновить статус подписки
const updateUserStatus = async (user) => {
  if (!isSubscriptionActive(user) && user.isPro) {
    user.isPro = false;
    await user.save();
  }
  return user;
};

// Проверить нужно ли сбросить счётчик
const shouldResetMessages = (user) => {
  const now = new Date();
  const resetDate = new Date(user.messagesResetDate);
  const daysDiff = (now - resetDate) / (1000 * 60 * 60 * 24);
  return daysDiff >= 30;
};

export async function aiReply(req, res) {
  try {
    const {
      model = "gpt-4o-mini",
      systemPrompt = "Отвечай кратко и по делу.",
      message = "",
      lang = "ru",
      contact = { name: "Клиент", isGroup: false },
      catalog = [],
      temperature = 0.3,
      maxTokens = 256,
      deviceId, // ← ДОБАВИЛИ deviceId
    } = req.body || {};

    // ========== ПРОВЕРКА ЛИМИТА ==========
    if (deviceId) {
      const user = await User.findOne({ where: { deviceId } });

      if (user) {
        // Обновить статус подписки
        const updatedUser = await updateUserStatus(user);

        // Проверить нужно ли сбросить счётчик
        if (shouldResetMessages(updatedUser)) {
          updatedUser.messagesThisMonth = 0;
          updatedUser.messagesResetDate = new Date();
          await updatedUser.save();
        }

        // Проверить лимит для FREE пользователей
        if (!updatedUser.isPro) {
          const FREE_LIMIT = 50;

          if (updatedUser.messagesThisMonth >= FREE_LIMIT) {
            console.log(
              `❌ Message limit reached for device: ${deviceId} (${updatedUser.messagesThisMonth}/${FREE_LIMIT})`
            );
            return res.status(403).json({
              error: "Message limit reached",
              reply:
                "⚠️ Лимит FREE версии исчерпан (50 сообщений/месяц). Перейдите на PRO для безлимитных ответов! 🚀",
              limit: {
                used: updatedUser.messagesThisMonth,
                total: FREE_LIMIT,
                isPro: false,
              },
            });
          }
        }

        console.log(
          `✅ Message allowed for device: ${deviceId} (${
            updatedUser.messagesThisMonth + 1
          }/${updatedUser.isPro ? "∞" : "50"})`
        );
      } else {
        console.warn(`⚠️ User not found for deviceId: ${deviceId}`);
      }
    }

    // ========== OPENAI REQUEST ==========
    const sys = [
      systemPrompt,
      "Правила: 1) 1–3 предложения, 2) без Markdown, 3) язык ответа = язык сообщения, 4) не выдумывай факты.",
      "Если уместно, ссылайся на товары/услуги из каталога.",
    ].join("\n");

    const user = [
      `Язык: ${lang}`,
      `Контакт: ${contact?.name ?? "Клиент"} (${
        contact?.isGroup ? "группа" : "личка"
      })`,
      `Сообщение: "${String(message ?? "").slice(0, 2000)}"`,
      `Каталог JSON: ${formatCatalog(catalog)}`,
      "Дай короткий, вежливый и полезный ответ.",
    ].join("\n");

    const resp = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
        temperature: clamp(+temperature, 0, 1),
        max_tokens: clamp(+maxTokens, 16, 1024),
      },
      {
        timeout: 15000,
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const reply = resp?.data?.choices?.[0]?.message?.content?.trim() || "";

    // ========== УВЕЛИЧИТЬ СЧЁТЧИК ==========
    if (deviceId) {
      const user = await User.findOne({ where: { deviceId } });
      if (user) {
        user.messagesThisMonth += 1;
        await user.save();
        console.log(
          `📈 Message count increased: ${user.messagesThisMonth} for device: ${deviceId}`
        );
      }
    }

    res.json({ reply });
  } catch (e) {
    const status = e?.response?.status || 500;
    const msg = e?.response?.data || { error: String(e?.message || e) };
    res.status(status).json({ error: msg });
  }
}
