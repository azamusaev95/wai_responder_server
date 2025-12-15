import axios from "axios";
import User from "../models/User.js";

// Кодовое слово, которое AI должен вернуть, если нужно промолчать
const SILENCE_TOKEN = "[SILENCE]";

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
      isNegotiable: x.isNegotiable === true,
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
  if (!user.messagesResetDate) return false;
  const now = new Date();
  return now >= new Date(user.messagesResetDate);
};

export async function aiReply(req, res) {
  try {
    const {
      model = "gpt-4o",
      systemPrompt = "You are a helpful assistant.",
      message = "",
      contact = { name: "Client", isGroup: false },
      catalog = [],
      temperature = 0.3,
      maxTokens = 256,
      deviceId,
    } = req.body || {};

    // ========== ПРОВЕРКА ЛИМИТА ==========
    if (deviceId) {
      const user = await User.findOne({ where: { deviceId } });

      if (user) {
        const updatedUser = await updateUserStatus(user);

        if (shouldResetMessages(updatedUser)) {
          const now = new Date();
          updatedUser.messagesThisMonth = 0;
          updatedUser.messagesResetDate = new Date(
            now.getTime() + 30 * 24 * 60 * 60 * 1000
          );
          await updatedUser.save();
          console.log(`🔄 Message counter reset for device: ${deviceId}`);
        }

        if (!updatedUser.isPro) {
          const FREE_LIMIT = 50;

          if (updatedUser.messagesThisMonth >= FREE_LIMIT) {
            console.log(
              `❌ Message limit reached for device: ${deviceId} (${updatedUser.messagesThisMonth}/${FREE_LIMIT})`
            );
            return res.status(403).json({
              error: "Message limit reached",
              reply:
                "⚠️ FREE версиясынын лимити бүттү (50 билдирүү/айына). PRO версиясына өтүңүз! 🚀",
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

    // ========== ПОДГОТОВКА СИСТЕМНОГО ПРОМПТА ==========
    // Добавляем инструкцию для молчания
    // Мы говорим AI: "Если вопрос не по теме бизнеса, или ты не знаешь ответа, верни ТОЛЬКО [SILENCE]"
    const modifiedSystemPrompt = `${systemPrompt}

    🛑 IMPORTANT RULE:
    If the user's message is:
    1. Irrelevant to the business described above.
    2. Just a generic "Ok", "Thanks", "👍" that doesn't need a reply.
    3. Something you don't know the answer to based on the info provided.
    
    Then output EXACTLY and ONLY this word: ${SILENCE_TOKEN}
    Do not apologize, do not say "I don't know". Just: ${SILENCE_TOKEN}`;

    // ========== ПОДГОТОВКА СООБЩЕНИЯ ==========
    const userMessage = [
      `Contact: ${contact?.name ?? "Client"} (${
        contact?.isGroup ? "group" : "private"
      })`,
      `Message: "${String(message ?? "").slice(0, 2000)}"`,
    ];

    if (Array.isArray(catalog) && catalog.length > 0) {
      userMessage.push(`Catalog (JSON): ${formatCatalog(catalog)}`);
    }

    // ========== OPENAI REQUEST ==========
    const resp = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model,
        messages: [
          { role: "system", content: modifiedSystemPrompt }, // Используем модифицированный промпт
          { role: "user", content: userMessage.join("\n") },
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

    let reply = resp?.data?.choices?.[0]?.message?.content?.trim() || "";
    let shouldReply = true;

    // ========== ПРОВЕРКА НА МОЛЧАНИЕ ==========
    if (reply.includes(SILENCE_TOKEN)) {
      console.log(`🤫 AI decided to stay silent for device: ${deviceId}`);
      reply = null; // Отправляем null
      shouldReply = false;
    }

    // ========== УВЕЛИЧИТЬ СЧЁТЧИК ==========
    // (Счетчик увеличиваем в любом случае, так как мы потратили токены OpenAI на проверку)
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

    // Возвращаем ответ
    // На клиенте (в Android) нужно проверить: if (response.reply === null) { ничего не делать }
    res.json({
      reply: reply,
      silence: !shouldReply, // Доп. флаг для удобства
    });
  } catch (e) {
    const status = e?.response?.status || 500;
    const msg = e?.response?.data || { error: String(e?.message || e) };
    res.status(status).json({ error: msg });
  }
}
