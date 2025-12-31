import axios from "axios";
import User from "../models/User.js";

// ✅ НАСТРОЙКИ GROQ (Llama 3.3)
const MODEL_NAME = "llama-3.3-70b-versatile";
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

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

const isSubscriptionActive = (user) => {
  if (!user.isPro) return false;
  if (!user.subscriptionExpires) return true;
  return new Date() < new Date(user.subscriptionExpires);
};

export async function aiReply(req, res) {
  try {
    const {
      systemPrompt = "",
      message = "",
      contact = { name: "Client" },
      catalog = [],
      deviceId,
    } = req.body || {};

    // 1. ПРОВЕРКА ЛИМИТОВ ПОЛЬЗОВАТЕЛЯ
    if (deviceId) {
      const user = await User.findOne({ where: { deviceId } });

      if (user) {
        // Проверка истечения подписки
        if (!isSubscriptionActive(user) && user.isPro) {
          user.isPro = false;
          await user.save();
        }

        // Сброс счетчика сообщений (раз в месяц)
        if (
          user.messagesResetDate &&
          new Date() >= new Date(user.messagesResetDate)
        ) {
          user.messagesThisMonth = 0;
          user.messagesResetDate = new Date(
            Date.now() + 30 * 24 * 60 * 60 * 1000
          );
          await user.save();
          console.log(`🔄 Message counter reset for device: ${deviceId}`);
        }

        // Лимит 50 сообщений для FREE
        if (!user.isPro && user.messagesThisMonth >= 50) {
          console.log(`❌ Limit reached: ${deviceId}`);
          return res.json({ limitReached: true, reply: null });
        }
      }
    }

    const cleanMessage = String(message ?? "").slice(0, 2000);

    // 2. СИСТЕМНЫЙ ПРОМПТ (Язык + Активность)
    const combinedInstructions = `
<system_configuration>
STRICT RULE: Detect the user's language and ALWAYS reply in that SAME language.
You are a proactive business assistant. Never be silent.
Answer clearly and concisely (max 150 chars).

BUSINESS CONTEXT:
${systemPrompt}
</system_configuration>

<context_data>
Contact: ${contact?.name ?? "Client"}
Catalog: ${
      Array.isArray(catalog) && catalog.length > 0
        ? formatCatalog(catalog)
        : "Empty"
    }
</context_data>

<user_input>
${cleanMessage}
</user_input>
`.trim();

    // 3. ЗАПРОС К GROQ
    const resp = await axios.post(
      GROQ_API_URL,
      {
        model: MODEL_NAME,
        messages: [{ role: "user", content: combinedInstructions }],
        max_tokens: 1024,
        temperature: 0.6, // Баланс между креативностью и строгостью языка
      },
      {
        timeout: 30000,
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    let reply = resp?.data?.choices?.[0]?.message?.content?.trim() || "";

    // 4. ОБНОВЛЕНИЕ СЧЕТЧИКА
    if (deviceId && reply) {
      const user = await User.findOne({ where: { deviceId } });
      if (user) {
        user.messagesThisMonth += 1;
        await user.save();
      }
    }

    res.json({
      reply,
      silence: false, // Мы принудительно говорим "не молчать"
    });
  } catch (e) {
    const errorMsg = e?.response?.data || e.message;
    console.error("[AI] Error:", JSON.stringify(errorMsg, null, 2));
    res.status(500).json({ error: errorMsg });
  }
}
