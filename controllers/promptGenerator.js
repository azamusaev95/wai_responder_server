import axios from "axios";
import User from "../models/User.js";
// Убедись, что путь к файлу констант правильный
import { FIRST_QUESTIONS } from "../constants/firstQuestions.js";

// --- 1. Промпт для AI-Интервьюера (тот, кто задает вопросы) ---
const GET_AI_INTERVIEWER_PROMPT = (lang) => `
You are an expert business analyst and AI prompt specialist.
Your task is to conduct a structured interview with a business owner to gather information for building their AI WhatsApp chatbot.

CURRENT LANGUAGE: ${lang} (You must conduct the interview in this language!)

OBJECTIVES (What you need to find out):
1. **Business Core**: What do they do? What do they sell?
2. **Unique Value**: Why should customers choose them?
3. **Logistics**: Delivery options, areas, costs, times (if applicable).
4. **Operations**: Physical address, opening hours.
5. **Payment**: Payment methods and SPECIFIC details (card numbers, wallet numbers, bank names) - *Ask for this explicitly*.
6. **Contacts**: Phone numbers, social media links to share with customers.
7. **Tone**: How should the AI speak? (Friendly, formal, funny, etc.)

RULES:
- Ask ONE question at a time. Do not overwhelm the user.
- Be friendly and professional. Use emojis appropriately.
- If the user's answer is vague, ask for clarification.
- If the user provides a lot of info at once, skip relevant questions.
- **CRITICAL**: After you have gathered enough information (usually 8-12 questions), or if the user asks to stop, you MUST reply with this exact JSON:
  { "question": "INTERVIEW_COMPLETE", "isComplete": true }

RESPONSE FORMAT:
Always reply with a JSON object:
{
  "question": "Your next question here in ${lang}",
  "isComplete": false
}
`;

// --- 2. Промпт для Генератора (создает финальную инструкцию) ---
const GET_PROMPT_GENERATOR_SYSTEM = (lang) => `
You are an expert AI Prompt Engineer.
Your goal is to write a highly effective **SYSTEM PROMPT** for a WhatsApp AI Assistant, based on the interview transcript provided.

TARGET LANGUAGE: ${lang} (The generated prompt must be in this language!)

🚨 **CRITICAL INSTRUCTION - PERSPECTIVE**:
- You are writing **INSTRUCTIONS FOR THE AI**, not a biography.
- **DO NOT** write: "I am a flower shop..."
- **MUST WRITE**: "You are a helpful AI assistant for [Business Name]..." or "Your role is to help customers..."
- Use imperative commands: "Answer politely", "Reject irrelevant questions", "If asked about delivery, say...".

**STRUCTURE OF THE GENERATED PROMPT:**

1. **Role & Identity**:
   - Define who the AI is (e.g., "You are the virtual manager of 'PizzaFast'...").
   - Define the personality (e.g., "Be polite, use emojis, keep answers short").

2. **Business Context**:
   - Briefly summarize what the business sells or offers.

3. **Knowledge Base (The Facts) - COPY EXACTLY**:
   - **Delivery**: Zones, prices, free delivery thresholds, timings.
   - **Address & Hours**: Exact location and working hours.
   - **Contacts**: Phone numbers, links.
   - **Payment Details**: List accepted methods AND specific requisites (card numbers, etc.) provided in the interview. This is crucial for sales.

4. **Behavioral Guidelines**:
   - "If you don't know the answer, ask the user to contact the manager."
   - "Respond in the same language as the user."
   - "Keep responses concise and mobile-friendly."

**OUTPUT**:
Return **ONLY** the text of the system prompt. Do not add markdown code blocks, do not add "Here is your prompt". Just the raw text.
`;

// --- Хранилище сессий (в памяти) ---
const interviewSessions = new Map();

// Очистка старых сессий (раз в 15 минут удаляем сессии старше 2 часов)
setInterval(() => {
  const now = Date.now();
  for (const [sessionId, session] of interviewSessions.entries()) {
    if (now - session.timestamp > 2 * 60 * 60 * 1000) {
      interviewSessions.delete(sessionId);
    }
  }
}, 15 * 60 * 1000);

// ==========================================
// API HANDLERS
// ==========================================

// 1. START INTERVIEW
export async function startInterview(req, res) {
  try {
    const { deviceId, language = "en" } = req.body;

    if (!deviceId) {
      return res.status(400).json({ error: "deviceId is required" });
    }

    const sessionId = `${deviceId}_${Date.now()}`;

    // ⚡ БЕРЕМ ГОТОВЫЙ ВОПРОС ИЗ ФАЙЛА КОНСТАНТ (Мгновенно)
    // Если языка нет в списке, берем английский ('en')
    const firstQuestion = FIRST_QUESTIONS[language] || FIRST_QUESTIONS["en"];

    interviewSessions.set(sessionId, {
      deviceId,
      language,
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

// 2. ANSWER QUESTION
export async function answerQuestion(req, res) {
  try {
    const { sessionId, answer } = req.body;

    if (!sessionId || !answer) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const session = interviewSessions.get(sessionId);
    if (!session) {
      return res.status(404).json({ error: "Session not found or expired" });
    }

    // Сохраняем ответ пользователя
    session.messages.push({ role: "user", content: answer });
    session.timestamp = Date.now();

    const questionCount = session.messages.filter(
      (m) => m.role === "user"
    ).length;

    // Жесткий лимит вопросов (на всякий случай)
    if (questionCount >= 15) {
      return finishInterview(res, session, sessionId, questionCount);
    }

    // Запрос к AI
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o", // Используем умную модель для ведения диалога
        messages: [
          {
            role: "system",
            content: GET_AI_INTERVIEWER_PROMPT(session.language),
          },
          ...session.messages,
        ],
        temperature: 0.7,
        response_format: { type: "json_object" }, // Обязательно требуем JSON
      },
      {
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      }
    );

    const content = response.data.choices[0].message.content;
    let aiResponse;

    try {
      aiResponse = JSON.parse(content);
    } catch (e) {
      // Fallback если AI вернул не JSON (редко, но бывает)
      aiResponse = { question: content, isComplete: false };
    }

    // Проверка на завершение
    if (
      aiResponse.isComplete ||
      aiResponse.question.includes("INTERVIEW_COMPLETE")
    ) {
      return finishInterview(res, session, sessionId, questionCount);
    }

    // Сохраняем вопрос AI
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

// Вспомогательная функция завершения (генерирует финальную фразу)
function finishInterview(res, session, sessionId, count) {
  // Простая локализация финальной фразы
  const finalPhrases = {
    ru: "Отлично! Я собрал всю информацию. Генерирую идеальный промпт... ✨",
    en: "Great! I've gathered all the info. Generating your perfect prompt... ✨",
    // Можно добавить другие языки или использовать английский как дефолт
  };

  const finalMsg = finalPhrases[session.language] || finalPhrases["en"];

  session.messages.push({ role: "assistant", content: finalMsg });

  return res.json({
    success: true,
    sessionId,
    question: finalMsg,
    questionNumber: count + 1,
    isComplete: true,
  });
}

// 3. GENERATE FINAL PROMPT
export async function generatePromptFromInterview(req, res) {
  try {
    const { sessionId } = req.body;
    const session = interviewSessions.get(sessionId);

    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    // Проверка PRO статуса (влияет на длину промпта)
    let isPro = false;
    try {
      const user = await User.findOne({
        where: { deviceId: session.deviceId },
      });
      if (user && user.isPro) isPro = true;
    } catch (e) {
      console.error("User check error", e);
    }

    // Инструкция по длине
    const lengthInstruction = isPro
      ? "Make the prompt detailed, comprehensive, and logically structured (up to 1500 chars). Use formatting."
      : "STRICT LIMIT: Keep the prompt under 600 characters. Remove filler words. Keep only essential facts.";

    // Собираем историю диалога
    const transcript = session.messages
      .map(
        (m) =>
          `${m.role === "user" ? "Business Owner" : "Interviewer"}: ${
            m.content
          }`
      )
      .join("\n\n");

    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini", // Mini отлично справляется с суммаризацией
        messages: [
          {
            role: "system",
            content: GET_PROMPT_GENERATOR_SYSTEM(session.language),
          },
          { role: "system", content: lengthInstruction },
          {
            role: "user",
            content: `Here is the interview transcript:\n\n${transcript}`,
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

// 4. REGENERATE PROMPT (Альтернативная версия)
export async function regeneratePrompt(req, res) {
  try {
    const { sessionId } = req.body;
    const session = interviewSessions.get(sessionId);
    if (!session) return res.status(404).json({ error: "Session not found" });

    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              GET_PROMPT_GENERATOR_SYSTEM(session.language) +
              "\n\nIMPORTANT: Create a DIFFERENT version. Change the structure or tone slightly.",
          },
          {
            role: "user",
            content: `Based on the previous interview transcript.`,
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
    res.status(500).json({ error: "Failed to regenerate" });
  }
}

// 5. CANCEL INTERVIEW
export async function cancelInterview(req, res) {
  const { sessionId } = req.body;
  if (sessionId && interviewSessions.has(sessionId)) {
    interviewSessions.delete(sessionId);
  }
  res.json({ success: true });
}
