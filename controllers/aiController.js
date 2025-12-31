import axios from "axios";
import User from "../models/User.js";

// ✅ 1. Используем Llama 3.3 на Groq
const MODEL_NAME = "meta-llama/llama-4-scout-17b-16e-instruct";
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

const updateUserStatus = async (user) => {
  if (!isSubscriptionActive(user) && user.isPro) {
    user.isPro = false;
    await user.save();
  }
  return user;
};

const shouldResetMessages = (user) => {
  if (!user.messagesResetDate) return false;
  const now = new Date();
  return now >= new Date(user.messagesResetDate);
};

export async function aiReply(req, res) {
  try {
    const {
      systemPrompt = "You are a helpful assistant.",
      message = "",
      contact = { name: "Client", isGroup: false },
      catalog = [],
      deviceId,
    } = req.body || {};

    // ========== ПРОВЕРКА ЛИМИТА ==========
    if (deviceId) {
      const user = await User.findOne({ where: { deviceId } });

      if (user) {
        const updatedUser = await updateUserStatus(user);

        // Сброс счетчика раз в месяц
        if (shouldResetMessages(updatedUser)) {
          const now = new Date();
          updatedUser.messagesThisMonth = 0;
          updatedUser.messagesResetDate = new Date(
            now.getTime() + 30 * 24 * 60 * 60 * 1000
          );
          await updatedUser.save();
          console.log(`🔄 Message counter reset for device: ${deviceId}`);
        }

        // Лимит 50 сообщений для FREE
        if (!updatedUser.isPro) {
          const FREE_LIMIT = 50;
          if (updatedUser.messagesThisMonth >= FREE_LIMIT) {
            console.log(
              `❌ Message limit reached: ${deviceId} (${updatedUser.messagesThisMonth})`
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
        console.log(`✅ Allowed: ${deviceId}`);
      }
    }

    // ========== PROMPT ==========
    const cleanMessage = String(message ?? "").slice(0, 2000);

    // 🔥 ИЗМЕНЕНИЕ: Убрали "Never be silent".
    // Добавили: "If the message is incoherent... return empty."
    const combinedInstructions = `
<system_configuration>
STRICT RULE: Detect the user's language and ALWAYS reply in that SAME language.
You are a helpful business assistant.
If the user message is incoherent, just symbols, or not a question/statement, reply with an empty string.
Keep answers concise (max 150 chars).

BUSINESS CONTEXT:
${systemPrompt}
</system_configuration>

<context_data>
Contact Name: ${contact?.name ?? "Client"}
Is Group Chat: ${contact?.isGroup ? "Yes" : "No"}
Catalog JSON: ${
      Array.isArray(catalog) && catalog.length > 0
        ? formatCatalog(catalog)
        : "Empty"
    }
</context_data>

<user_input>
${cleanMessage}
</user_input>
    `.trim();

    // ========== GROQ REQUEST ==========
    console.log(`[AI] Requesting Groq: ${MODEL_NAME}...`);

    const resp = await axios.post(
      GROQ_API_URL,
      {
        model: MODEL_NAME,
        messages: [{ role: "user", content: combinedInstructions }],
        max_tokens: 1024,
        temperature: 0.1,
      },
      {
        timeout: 30000,
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    let reply = resp?.data?.choices?.[0]?.message?.content?.trim();

    // Если Groq вернул пустоту, значит он решил промолчать
    if (!reply) {
      console.log("[AI] 🤫 AI chose silence.");
      reply = "";
    }

    // ========== УВЕЛИЧИТЬ СЧЁТЧИК (ТОЛЬКО ЕСЛИ ОТВЕТИЛ) ==========
    if (deviceId && reply && reply.length > 0) {
      const user = await User.findOne({ where: { deviceId } });
      if (user) {
        user.messagesThisMonth += 1;
        await user.save();
      }
    }

    res.json({
      reply,
      silence: !reply || reply.length === 0,
    });
  } catch (e) {
    const status = e?.response?.status || 500;
    const msg = e?.response?.data || { error: String(e?.message || e) };
    console.error("[AI] Groq Error:", JSON.stringify(msg, null, 2));
    res.status(status).json({ error: msg });
  }
}
