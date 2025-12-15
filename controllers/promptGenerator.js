import axios from "axios";
import User from "../models/User.js";
import { FIRST_QUESTIONS } from "../constants/firstQuestions.js";

// --- 1. Промпт для AI-Интервьюера (сбор данных) ---
const GET_AI_INTERVIEWER_PROMPT = (lang) => `
You are an expert business analyst and AI prompt specialist.
Your task is to conduct a structured interview with a business owner to gather information for building their AI WhatsApp chatbot.

CURRENT LANGUAGE: ${lang} (You must conduct the interview in this language!)

OBJECTIVES (What you need to find out):
1. **Business Core**: What do they do? Products or Services? (e.g., Shop, Restaurant, Dentist, Lawyer).
2. **Unique Value**: Why should customers choose them?
3. **Logistics (ONLY for Physical Goods/Food)**: Delivery options, areas, costs. **SKIP THIS** if the business is a service (e.g., Dentist, Lawyer, Salon, Consultant) or digital only.
4. **Operations**: Physical address, opening hours (Booking rules if it's a service).
5. **Payment**: Payment methods and SPECIFIC details (card numbers, wallet numbers, bank names) - *Ask for this explicitly*.
6. **Contacts**: Phone numbers, social media links.
7. **Tone**: How should the AI speak? (Friendly, formal, funny, etc.)

RULES:
- **CONTEXT AWARENESS**: Analyze the user's answer to Objective 1 ("Business Core"). If they are a service provider (lawyer, doctor, etc.), DO NOT ask about delivery. Go straight to Operations.
- Ask ONE question at a time.
- Be friendly and professional.
- If the user provides a lot of info at once, skip relevant questions.
- **CRITICAL**: After you have gathered enough information, or if the user asks to stop, reply with:
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
- **DO NOT** write: "I am a dentist..."
- **MUST WRITE**: "You are a helpful AI assistant for [Business Name]..."
- Use imperative commands: "Answer politely", "If asked about prices, say...".

**STRUCTURE OF THE GENERATED PROMPT:**

1. **Role & Identity**:
   - Define who the AI is (e.g., "You are the virtual receptionist...").
   - Define the personality.

2. **Business Context**:
   - Briefly summarize what the business offers.

3. **Knowledge Base (The Facts) - COPY EXACTLY**:
   - **Services/Products**: List main offerings.
   - **Logistics/Delivery**: ONLY include this if the business actually offers delivery. If it is a service (lawyer, doctor), OMIT this section.
   - **Address & Hours**: Exact location and working hours.
   - **Contacts**: Phone numbers, links.
   - **Payment Details**: List accepted methods AND specific requisites.

4. **Behavioral Guidelines (CRITICAL)**:
   - "If the user asks something UNRELATED to this business, politely explain that you can only help with questions related to [Business Name]."
   - "If you strictly DON'T know the answer based on these instructions, simply apologize and say you don't have that information right now."
   - "Respond in the same language as the user."
   - "Keep responses concise and mobile-friendly."
   - "Do NOT instruct the user to contact a manager unless a specific support number is provided."

**OUTPUT**:
Return **ONLY** the text of the system prompt. No markdown, no intros.
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
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: GET_AI_INTERVIEWER_PROMPT(session.language),
          },
          ...session.messages,
        ],
        temperature: 0.7,
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
    ru: "Отлично! Я собрал всю информацию. Генерирую идеальный промпт... ✨",
    en: "Great! I've gathered all the info. Generating your perfect prompt... ✨",
    tr: "Harika! Tüm bilgileri topladım. Mükemmel istemi oluşturuyorum... ✨",
    ky: "Азаматсыз! Бардык маалыматты чогулттум. Идеалдуу промпт түзүп жатам... ✨",
    uz: "Ajoyib! Barcha ma'lumotlarni to'pladim. Ideal prompt yaratyapman... ✨",
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

    let isPro = false;
    try {
      const user = await User.findOne({
        where: { deviceId: session.deviceId },
      });
      if (user && user.isPro) isPro = true;
    } catch (e) {
      console.error("User check error", e);
    }

    const lengthInstruction = isPro
      ? "Make the prompt detailed and comprehensive (up to 1500 chars). Ensure the tone matches the owner's request."
      : "STRICT LIMIT: Keep under 600 chars. Focus on the most important business details.";

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
