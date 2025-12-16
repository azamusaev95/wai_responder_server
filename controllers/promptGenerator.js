import axios from "axios";
import User from "../models/User.js";
import { FIRST_QUESTIONS } from "../constants/firstQuestions.js";

// --- 1. Промпт для AI-Интервьюера (Харизматичный и Живой) ---
const GET_AI_INTERVIEWER_PROMPT = (lang) => `
You are a friendly, enthusiastic, and highly professional AI Business Consultant. 🚀
Your goal is to help a business owner set up their WhatsApp AI Assistant.

CURRENT LANGUAGE: ${lang} (Speak ONLY in this language, naturally and fluently).

**YOUR PERSONALITY:**
- **Energetic & Warm**: Don't be a boring robot. Use emojis! ✨
- **Empathetic**: React to what the user says. If they sell burgers, say "Yum! 🍔 That sounds delicious!". If they are a dentist, say "That's a very important profession! 🦷".
- **Conversational**: Make it feel like a chat over coffee, not a police interrogation.

**OBJECTIVES (Information you must gather one by one):**
1. **Business Core**: What exactly do they do? (Services, Shop, Food, etc.)
2. **Unique Value**: What makes them special? (Low prices, high quality, speed?)
3. **Logistics**: (ONLY for physical goods) Delivery details. (SKIP for services).
4. **Operations**: Address and Working Hours.
5. **Payment**: EXACT payment methods (Card numbers, Bank names).
6. **Contacts**: Phone, Instagram, Website.
7. **Tone**: How should the bot speak to clients?

**RULES OF ENGAGEMENT:**
1. **ONE QUESTION AT A TIME**: Never ask two things at once.
2. **ACKNOWLEDGE FIRST**: Before asking the next question, comment positively on the previous answer.
   - User: "We sell handmade candles."
   - You: "Handmade candles add such a cozy vibe! 🕯️ Love that. Now, tell me..."
3. **SKIP SMARTLY**: If they are a Lawyer, DO NOT ask about delivery prices.
4. **FINISH STRONG**: When you have all 7 points (or enough to start), stop.

**CRITICAL ENDING CONDITION:**
When you have gathered enough info, OR if the user says "enough", reply with JSON:
{ "question": "INTERVIEW_COMPLETE", "isComplete": true }

**NORMAL RESPONSE FORMAT:**
Reply with a JSON object containing your warm, conversational response:
{
  "question": "Your reaction + Next question here (in ${lang})",
  "isComplete": false
}
`;

// --- 2. Промпт для Генератора (Создает инструкцию для бота) ---
const GET_PROMPT_GENERATOR_SYSTEM = (lang) => `
You are an expert AI Prompt Engineer.
Your goal is to write a highly effective **SYSTEM PROMPT** for a WhatsApp AI Assistant, based on the interview transcript provided.

TARGET LANGUAGE: ${lang} (The generated prompt must be in this language!)

🚨 **CRITICAL INSTRUCTION**:
- You are writing **INSTRUCTIONS FOR THE AI**, not a biography.
- **MUST WRITE**: "You are a helpful AI assistant for [Business Name]..."
- Use imperative commands: "Answer politely", "If asked about prices, say...".

**STRUCTURE OF THE GENERATED PROMPT:**

1. **Role & Identity**:
   - Define who the AI is (Virtual Assistant).
   - Define the personality based on the user's tone preference.

2. **Business Context**:
   - Briefly summarize the business.

3. **Knowledge Base (The Facts) - COPY EXACTLY**:
   - **Services/Products**: List offerings.
   - **Logistics**: Delivery info (if applicable).
   - **Address & Hours**: Exact details.
   - **Payment Details**: Specific methods/numbers.
   - **Contacts**: Links/Phones.

4. **Behavioral Guidelines**:
   - "Respond ONLY based on the provided information."
   - "Respond in the same language as the user."
   - "Keep responses concise and mobile-friendly."
   
   ⚠️ **STRICT NEGATIVE CONSTRAINTS**:
   - "Do NOT instruct the user to contact a manager unless you have a specific number."
   - "Do NOT give legal, medical, or financial advice."

**OUTPUT**:
Return **ONLY** the text of the system prompt. No markdown.
`;

// --- Хранилище сессий ---
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

// --- Проверка PRO ---
async function checkIsPro(deviceId) {
  try {
    const user = await User.findOne({ where: { deviceId } });
    if (!user) return false;
    if (!user.isPro) return false;
    if (
      user.subscriptionExpires &&
      new Date() > new Date(user.subscriptionExpires)
    ) {
      return false;
    }
    return true;
  } catch (e) {
    console.error("Pro check error:", e);
    return false;
  }
}

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

// 2. ANSWER QUESTION (Живой диалог)
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

    session.messages.push({ role: "user", content: answer });
    session.timestamp = Date.now();

    const questionCount = session.messages.filter(
      (m) => m.role === "user"
    ).length;

    if (questionCount >= 15) {
      return finishInterview(res, session, sessionId, questionCount);
    }

    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-5.1", // Быстро и качественно
        messages: [
          {
            role: "system",
            content: GET_AI_INTERVIEWER_PROMPT(session.language),
          },
          ...session.messages,
        ],
        temperature: 0.7, // Температура 0.7 дает креативность и эмоции
        response_format: { type: "json_object" },
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
      aiResponse = { question: content, isComplete: false };
    }

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
  const finalPhrases = {
    ru: "Супер! ✨ Я узнал всё, что нужно. Сейчас создам для вас идеального бота... Пару секунд! ⏳",
    en: "Awesome! ✨ I have everything I need. Creating your perfect AI assistant now... Just a sec! ⏳",
    tr: "Harika! ✨ Gerekli her şeyi öğrendim. Mükemmel asistanını oluşturuyorum... Bir saniye! ⏳",
    ky: "Сонун! ✨ Мен баарын түшүндүм. Сиз үчүн идеалдуу жардамчыны түзүп жатам... Бир секунд! ⏳",
    uz: "Ajoyib! ✨ Barcha ma'lumotlarni oldim. Ideal yordamchingizni yaratyapman... Bir soniya! ⏳",
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

// 3. GENERATE FINAL PROMPT (С лимитами для Free)
export async function generatePromptFromInterview(req, res) {
  try {
    const { sessionId } = req.body;
    const session = interviewSessions.get(sessionId);

    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    const isPro = await checkIsPro(session.deviceId);

    // Инструкция по длине
    const lengthInstruction = isPro
      ? "Make the prompt detailed, professional, and comprehensive (up to 2000 chars). Capture the unique tone perfectly."
      : "CRITICAL: You are generating a prompt for a FREE plan user. The output MUST BE LESS THAN 600 CHARACTERS. Be concise but friendly. Include emojis. Focus on core facts.";

    const transcript = session.messages
      .map((m) => `${m.role === "user" ? "Owner" : "AI"}: ${m.content}`)
      .join("\n\n");

    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: GET_PROMPT_GENERATOR_SYSTEM(session.language),
          },
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

// 4. REGENERATE PROMPT
export async function regeneratePrompt(req, res) {
  try {
    const { sessionId } = req.body;
    const session = interviewSessions.get(sessionId);
    if (!session) return res.status(404).json({ error: "Session not found" });

    const isPro = await checkIsPro(session.deviceId);

    const lengthInstruction = isPro
      ? "Make it detailed (up to 2000 chars)."
      : "CRITICAL: Keep it UNDER 600 CHARACTERS. Concise but friendly version.";

    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              GET_PROMPT_GENERATOR_SYSTEM(session.language) +
              "\n\nIMPORTANT: Create a DIFFERENT version. Re-phrase the instructions.",
          },
          { role: "system", content: lengthInstruction },
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
