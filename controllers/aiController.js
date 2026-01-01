import axios from "axios";

import User from "../models/User.js";

// ✅ Llama 3.3 70B (Самая умная на Groq)
// const MODEL_NAME = "llama-3.3-70b-versatile";
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
      systemPrompt = "", // Может быть: текст из Home ИЛИ служебный промпт ("Return ONLY JSON ...")
      message = "",
      contact = { name: "Client", isGroup: false },
      catalog = [],
      deviceId,
    } = req.body || {};

    // =========================================================
    // 🔥 ОТЛАДКА: СМОТРИ СЮДА В ТЕРМИНАЛЕ
    // =========================================================
    console.log("\n================ [DEBUG START] ================");
    console.log(`📱 Device: ${deviceId}`);
    console.log(`📏 Prompt Length: ${systemPrompt.length} chars`);
    console.log("📜 ACTUAL PROMPT RECEIVED:");
    console.log("-----------------------------------------------");
    console.log(systemPrompt); // <-- ДОЛЖЕН ПРИХОДИТЬ ИЗ HOME БЕЗ ИЗМЕНЕНИЙ
    console.log("-----------------------------------------------");
    console.log("================ [DEBUG END] ==================\n");
    // =========================================================

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
          console.log(`🔄 Counter reset: ${deviceId}`);
        }

        if (!updatedUser.isPro) {
          const FREE_LIMIT = 50;
          if (updatedUser.messagesThisMonth >= FREE_LIMIT) {
            console.log(`❌ Limit reached: ${deviceId}`);
            return res.json({ limitReached: true, reply: null });
          }
        }
      }
    }

    // ========== ПОДГОТОВКА ДАННЫХ ==========
    const cleanMessage = String(message ?? "").slice(0, 2000);
    const catalogJson =
      Array.isArray(catalog) && catalog.length > 0
        ? formatCatalog(catalog)
        : "Empty";

    // ========== ОПРЕДЕЛЯЕМ РЕЖИМ: JSON или ДИАЛОГ С КЛИЕНТОМ ==========
    const rawSystemPrompt = String(systemPrompt || "");
    const isJsonMode = rawSystemPrompt
      .trim()
      .toLowerCase()
      .startsWith("return only json");

    let combinedInstructions;

    if (isJsonMode) {
      // 🔹 Режим классификации / служебный: НЕ добавляем правила молчания,
      // НЕ вмешиваемся — просто помогаем вернуть JSON.
      combinedInstructions = `
${rawSystemPrompt}

User message: "${cleanMessage}"
      `.trim();
    } else {
      // 🔹 Обычный клиентский режим: промпт из Home — главный, добавляем
      // короткие правила про __SILENCE__ и учитываем History/Current.
      const safetyNote = `
IMPORTANT:
The main prompt above has the highest priority — follow it first.
If the topic is legal, financial, medical, family/personal, or the information is missing, return "__SILENCE__".

      `.trim();

      combinedInstructions = `
${rawSystemPrompt}

${safetyNote}

--- INSTRUCTIONS ---
- Always reply in the same language as the client’s last message.
- Use only the main prompt, catalog, and chat history.
- History is context — answer only to “Current”.
- Keep answers brief (max 2 sentences).

--- 📦 PRODUCTS / SERVICES ---
${catalogJson}

--- 💬 CHAT HISTORY & CURRENT MESSAGE ---
${cleanMessage}
      `.trim();
    }

    // ========== ЗАПРОС К GROQ ==========
    console.log(`[AI] Sending to Groq (${MODEL_NAME})...`);

    const resp = await axios.post(
      GROQ_API_URL,
      {
        model: MODEL_NAME,
        messages: [{ role: "user", content: combinedInstructions }],
        max_tokens: 1024,
        temperature: 0.3, // 0.3 - идеальный баланс между роботом и собеседником
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

    // Если модель решила "молчать" через __SILENCE__ — не отправляем текст
    if (reply === "__SILENCE__") reply = "";

    // Жёстко ограничиваем длину ответа
    if (reply && reply.length > 200) {
      reply = reply.slice(0, 200).trim();
    }

    // ========== УВЕЛИЧЕНИЕ СЧЕТЧИКА ==========
    if (deviceId && reply.length > 0) {
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
    console.error("[AI] Error:", JSON.stringify(msg, null, 2));
    res.status(status).json({ error: msg });
  }
}
