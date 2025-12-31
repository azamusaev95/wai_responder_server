import {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
} from "@google/generative-ai";
import User from "../models/User.js";

// ✅ ИСПОЛЬЗУЕМ Gemini 2.0 Flash
// Самая новая, быстрая и дешевая модель на данный момент.
// ID может быть 'gemini-2.0-flash-exp' или 'gemini-2.0-flash' (проверь в доках точный ID)
const MODEL_NAME = "gemini-2.0-flash-exp";

// Инициализация
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

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

const updateUserStatus = async (user) => {
  if (
    user.isPro &&
    user.subscriptionExpires &&
    new Date() > new Date(user.subscriptionExpires)
  ) {
    user.isPro = false;
    await user.save();
  }
  return user;
};

const shouldResetMessages = (user) => {
  if (!user.messagesResetDate) return false;
  return new Date() >= new Date(user.messagesResetDate);
};

export async function aiReply(req, res) {
  try {
    const {
      systemPrompt = "",
      message = "",
      contact = { name: "Client", isGroup: false },
      catalog = [],
      deviceId,
    } = req.body || {};

    console.log(`[AI] Request: ${MODEL_NAME} | Device: ${deviceId}`);

    // ========== 1. ПРОВЕРКА ЛИМИТОВ ==========
    // Технический запрос классификатора содержит "JSON" в промпте. Его не лимитируем.
    const isJsonRequest = systemPrompt.includes("JSON");

    if (deviceId && !isJsonRequest) {
      const user = await User.findOne({ where: { deviceId } });
      if (user) {
        const updatedUser = await updateUserStatus(user);

        if (shouldResetMessages(updatedUser)) {
          updatedUser.messagesThisMonth = 0;
          updatedUser.messagesResetDate = new Date(
            Date.now() + 30 * 24 * 60 * 60 * 1000
          );
          await updatedUser.save();
          console.log(`🔄 Limits reset for: ${deviceId}`);
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

    // ========== 2. ПОДГОТОВКА ДАННЫХ ==========
    const cleanMessage = String(message ?? "").slice(0, 2000);
    const catalogJson =
      Array.isArray(catalog) && catalog.length > 0
        ? formatCatalog(catalog)
        : "";

    // ========== 3. ИНСТРУКЦИИ ==========
    let finalSystemInstruction = "";

    if (isJsonRequest) {
      // Для классификатора
      finalSystemInstruction = systemPrompt;
    } else {
      // Для ответов клиентам (Жесткая привязка к контексту)
      finalSystemInstruction = `
You are a smart business assistant.
Your knowledge is STRICTLY limited to the "BUSINESS_DATA" below.

<BUSINESS_DATA>
${systemPrompt}

${catalogJson ? `CATALOG / PRICES:\n${catalogJson}` : ""}
</BUSINESS_DATA>

RULES:
1. **Source of Truth:** Answer ONLY using the provided BUSINESS_DATA.
2. **Anti-Hallucination:** Do NOT invent addresses, prices, or services. If info is missing, say "I don't have that info".
3. **Language:** Detect user's language and reply in the same language.
4. **Tone:** Be professional and concise (max 2-3 sentences).
5. **Safety:** If the user is rude, be polite.
      `.trim();
    }

    // ========== 4. МОДЕЛЬ ==========
    const model = genAI.getGenerativeModel({
      model: MODEL_NAME,
      systemInstruction: finalSystemInstruction,
      // Отключаем лишнюю цензуру, чтобы не блокировал жалобы клиентов
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
        },
        {
          category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
        },
        {
          category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
        },
        {
          category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
        },
      ],
    });

    // ========== 5. ЗАПРОС ==========
    const generationConfig = {
      maxOutputTokens: isJsonRequest ? 200 : 500,
      temperature: isJsonRequest ? 0.1 : 0.3, // 0.3 для ответов - хороший баланс
      responseMimeType: isJsonRequest ? "application/json" : "text/plain",
    };

    const userPrompt = isJsonRequest
      ? cleanMessage
      : `Client Name: ${contact?.name ?? "Client"}\nMessage: "${cleanMessage}"`;

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig,
    });

    const response = await result.response;
    let reply = response.text().trim();

    // Чистка Markdown
    if (!isJsonRequest && reply) {
      reply = reply.replace(/\*\*/g, "").replace(/\*/g, "");
    }

    // ========== 6. СЧЕТЧИК ==========
    if (deviceId && !isJsonRequest && reply.length > 0) {
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
    console.error("[AI] Gemini Error:", e.message);

    // Обработка ошибок безопасности
    if (e.message?.includes("SAFETY") || e.message?.includes("blocked")) {
      console.log("⚠️ Blocked by Safety Filters");
      return res.json({ reply: "", silence: true });
    }

    // Обработка неверного имени модели (если 2.0 еще не доступна на твоем ключе)
    if (e.message?.includes("models/")) {
      console.error(
        "⚠️ Invalid Model Name. Check if 'gemini-2.0-flash-exp' is valid."
      );
    }

    res.status(500).json({ error: "AI Error" });
  }
}
