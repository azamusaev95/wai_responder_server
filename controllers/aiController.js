import axios from "axios";
import User from "../models/User.js";

// 🔥 ЖЕСТКАЯ ПРИВЯЗКА МОДЕЛИ НА СЕРВЕРЕ
const MODEL_NAME = "gpt-5-mini";

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
      // model убрали из чтения, используем константу MODEL_NAME
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
            return res.json({
              limitReached: true,
              reply: null,
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
    const modifiedSystemPrompt = `${systemPrompt}

SAFETY RULES:
- Do NOT provide professional Legal, Financial, or Medical advice.
- If the user asks about these topics, briefly say you are not allowed to advise and suggest contacting a specialist.
- Prefer to answer only questions related to this specific business, its products, services and catalog.
- If required information is missing, politely say you don't know or that the manager can clarify.`;

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

    // ========== OPENAI REQUEST (GPT-5 MINI) ==========
    console.log(`[AI] Requesting ${MODEL_NAME}...`);

    const resp = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: MODEL_NAME, // <--- Используем жестко заданную модель
        messages: [
          { role: "system", content: modifiedSystemPrompt },
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

    // Возвращаем ответ
    res.json({
      reply,
      silence: false,
    });
  } catch (e) {
    const status = e?.response?.status || 500;
    const msg = e?.response?.data || { error: String(e?.message || e) };
    console.error("[AI] Error:", msg);
    res.status(status).json({ error: msg });
  }
}
