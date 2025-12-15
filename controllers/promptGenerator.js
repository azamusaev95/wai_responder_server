// controllers/promptGenerator.js
import axios from "axios";
import User from "../models/User.js";

// Базовый промпт (шаблон)
const GET_AI_INTERVIEWER_PROMPT = (lang) => `
Ты — эксперт по созданию промптов для WhatsApp AI-ассистентов.
Твоя задача — провести короткое интервью (8-12 вопросов) с владельцем бизнеса.

ЯЗЫК ИНТЕРВЬЮ: ${lang} (ОБЯЗАТЕЛЬНО пиши только на этом языке!)

ТВОЯ ЦЕЛЬ — понять:
1. Чем занимается бизнес
2. Особенности и преимущества
3. Доставка (если есть)
4. Контактные данные (адрес, график, оплата, реквизиты)
5. Стиль общения

ПРАВИЛА:
- Задавай ОДИН вопрос за раз.
- Будь дружелюбным, используй эмодзи.
- Если клиент пишет на другом языке, переключись на него.
- После 8-12 вопросов верни строго фразу: "INTERVIEW_COMPLETE".

ФОРМАТ ОТВЕТА (JSON):
{
  "question": "Твой вопрос на языке ${lang}",
  "isComplete": false
}
`;

// Промпт для генерации первого сообщения
const GET_FIRST_MESSAGE_PROMPT = (lang) => `
Поздоровайся с пользователем на языке "${lang}".
Представься как помощник по созданию AI-ассистента.
Спроси первым делом: "Чем занимается ваш бизнес?".
Используй эмодзи. Будь краток.
Верни только текст вопроса.
`;

const GET_PROMPT_GENERATOR_SYSTEM = (lang) => `
На основе интервью создай ИДЕАЛЬНЫЙ системный промпт для WhatsApp AI-ассистента.

ЯЗЫК ПРОМПТА: ${lang} (Весь текст промпта должен быть на этом языке!)

СТРУКТУРА:
1. Роль и Оффер
2. Преимущества
3. Условия доставки/выезда (если есть)
4. КОНТАКТЫ И ОПЛАТА (Адрес, График, Реквизиты - перепиши точно)
5. Тон общения

Верни ТОЛЬКО текст промпта. Никаких вступлений.
`;

const interviewSessions = new Map();

// Очистка старых сессий
setInterval(() => {
  const now = Date.now();
  for (const [sessionId, session] of interviewSessions.entries()) {
    if (now - session.timestamp > 2 * 60 * 60 * 1000) {
      interviewSessions.delete(sessionId);
    }
  }
}, 15 * 60 * 1000);

// --- 1. Начать интервью ---
export async function startInterview(req, res) {
  try {
    const { deviceId, language = "en" } = req.body; // Получаем язык

    if (!deviceId) {
      return res.status(400).json({ error: "deviceId is required" });
    }

    const sessionId = `${deviceId}_${Date.now()}`;

    // Генерируем первое сообщение на нужном языке через AI (чтобы было красиво)
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini", // Быстрая модель для приветствия
        messages: [
          { role: "system", content: GET_FIRST_MESSAGE_PROMPT(language) },
        ],
        temperature: 0.7,
      },
      {
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      }
    );

    const firstQuestion =
      response.data.choices[0].message.content.trim() ||
      "Hello! Let's create an AI assistant for you. What does your business do?";

    interviewSessions.set(sessionId, {
      deviceId,
      language, // Сохраняем язык в сессии
      messages: [
        {
          role: "assistant",
          content: firstQuestion,
        },
      ],
      timestamp: Date.now(),
    });

    res.json({
      success: true,
      sessionId,
      question: firstQuestion,
      questionNumber: 1,
      isComplete: false,
    });
  } catch (e) {
    console.error("[INTERVIEW] Error starting:", e);
    res.status(500).json({ error: "Internal server error" });
  }
}

// --- 2. Ответить и получить следующий вопрос ---
export async function answerQuestion(req, res) {
  try {
    const { sessionId, answer } = req.body;

    if (!sessionId || !answer) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const session = interviewSessions.get(sessionId);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    session.messages.push({ role: "user", content: answer });
    session.timestamp = Date.now();

    const questionCount = session.messages.filter(
      (m) => m.role === "user"
    ).length;

    // Лимит вопросов
    if (questionCount >= 12) {
      return finishInterview(res, session, sessionId, questionCount);
    }

    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: GET_AI_INTERVIEWER_PROMPT(session.language),
          }, // Передаем язык
          ...session.messages,
        ],
        temperature: 0.7,
        response_format: { type: "json_object" }, // Форсируем JSON
      },
      {
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      }
    );

    const aiResponse = JSON.parse(response.data.choices[0].message.content);

    if (
      aiResponse.isComplete ||
      aiResponse.question.includes("INTERVIEW_COMPLETE")
    ) {
      return finishInterview(res, session, sessionId, questionCount);
    }

    session.messages.push({ role: "assistant", content: aiResponse.question });

    res.json({
      success: true,
      sessionId,
      question: aiResponse.question,
      questionNumber: questionCount + 1,
      isComplete: false,
    });
  } catch (e) {
    console.error("[INTERVIEW] Error answering:", e);
    res.status(500).json({ error: "Failed to get next question" });
  }
}

// Вспомогательная функция завершения
function finishInterview(res, session, sessionId, count) {
  // Генерируем финальную фразу на языке пользователя
  const finalMsg =
    session.language === "ru"
      ? "Отлично! Я собрал всю информацию. Генерирую промпт... ✨"
      : "Great! I have all the info. Generating your prompt... ✨"; // Упрощенно, лучше тоже через AI, но для скорости сойдет

  session.messages.push({ role: "assistant", content: finalMsg });

  return res.json({
    success: true,
    sessionId,
    question: finalMsg,
    questionNumber: count + 1,
    isComplete: true,
  });
}

// --- 3. Генерация финального промпта ---
export async function generatePromptFromInterview(req, res) {
  try {
    const { sessionId } = req.body;
    const session = interviewSessions.get(sessionId);
    if (!session) return res.status(404).json({ error: "Session not found" });

    // Проверка PRO
    let isPro = false;
    const user = await User.findOne({ where: { deviceId: session.deviceId } });
    if (user && user.isPro) isPro = true;

    const lengthInstruction = isPro
      ? "Make the prompt detailed, professional, and selling (500-1500 chars)."
      : "STRICT LIMIT: Keep the prompt under 600 chars. Concise and essential info only.";

    const transcript = session.messages
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");

    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: GET_PROMPT_GENERATOR_SYSTEM(session.language),
          }, // Язык!
          { role: "system", content: lengthInstruction },
          {
            role: "user",
            content: `Interview Transcript:\n${transcript}`,
          },
        ],
        temperature: 0.7,
      },
      {
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      }
    );

    const generatedPrompt = response.data.choices[0].message.content.trim();

    res.json({
      success: true,
      prompt: generatedPrompt,
      sessionId,
      isPro,
    });
  } catch (e) {
    console.error("[PROMPT_GEN] Error:", e);
    res.status(500).json({ error: "Generation failed" });
  }
}

// --- 4. Регенерация ---
export async function regeneratePrompt(req, res) {
  // Логика аналогична generatePromptFromInterview, просто меняем system prompt на "Create ALTERNATIVE version"
  // Используем session.language
  // ... (код аналогичен, просто добавь session.language в промпт)
  try {
    const { sessionId } = req.body;
    const session = interviewSessions.get(sessionId);
    if (!session) return res.status(404).json({ error: "Session not found" });

    // Проверка PRO (упрощенно)
    let isPro = false;
    // ... (check user logic)

    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              GET_PROMPT_GENERATOR_SYSTEM(session.language) +
              "\n\nCreate a DIFFERENT version (change tone/structure).",
          },
          {
            role: "user",
            content: `Based on previous interview.`, // Или полный транскрипт
          },
        ],
      },
      { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }
    );

    res.json({
      success: true,
      prompt: response.data.choices[0].message.content.trim(),
    });
  } catch (e) {
    res.status(500).json({ error: "Failed" });
  }
}

export async function cancelInterview(req, res) {
  const { sessionId } = req.body;
  interviewSessions.delete(sessionId);
  res.json({ success: true });
}
