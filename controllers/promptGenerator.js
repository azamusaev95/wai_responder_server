import axios from "axios";
import User from "../models/User.js";
import { FIRST_QUESTIONS } from "../constants/firstQuestions.js";

// ✅ CONFIGURATION FOR GROQ
const MODEL_NAME = "llama-3.3-70b-versatile";
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

// --- HELPER: Extract JSON ---
function extractJson(text) {
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end !== -1) {
      return JSON.parse(text.substring(start, end + 1));
    }
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

// --- 1. 🔥 ЖИВОЙ ИНТЕРВЬЮЕР (Friendly & Engaging) ---
const GET_AI_INTERVIEWER_PROMPT = (lang) => `
You are a **Friendly and Enthusiastic AI Onboarding Specialist**.
Your goal is to help a business owner set up their AI chatbot by asking simple questions.

CURRENT LANGUAGE: ${lang} (MUST conduct the interview in this language!)

**YOUR PERSONALITY:**
- **Warm & Encouraging**: Use emojis (✨, 🚀, 👍, 📍). Be polite and supportive.
- **Conversational**: Don't just ask dry questions. Briefly acknowledge their previous answer before asking the next one.
  - *Bad*: "What is your address?"
  - *Good*: "Got it! That sounds great. 👍 Now, where is your business located? 📍"

**OBJECTIVES (Collect this info):**
1. **Business Core**: What do they do? (Shop, Cafe, Service?)
2. **Unique Value**: Why are they special?
3. **Logistics**: Delivery? (SKIP if it's a Service/Doctor/Lawyer).
4. **Operations**: Address & Hours.
5. **Payment**: Methods (Cards, Cash, Bank info).
6. **Contacts**: Phone, Insta, Website.
7. **Tone**: How should the bot speak? (Formal, Funny, Friendly?)

**RULES:**
- Ask **ONE** question at a time.
- If they answer multiple things at once, tick those boxes off your list and move to the next missing item.
- If you have enough info, return "isComplete": true.

**RESPONSE FORMAT (CRITICAL):**
You must return ONLY a JSON object. The "question" field must contain your friendly message.
{
  "question": "Your friendly, emoji-rich question here...",
  "isComplete": false
}
`;

// --- 2. 🔥 МОЩНЫЙ ГЕНЕРАТОР (Rich & Sales-Oriented) ---
const GET_PROMPT_GENERATOR_SYSTEM = (lang) => `
You are an **Elite AI Persona Architect & Copywriter**.
Transform interview facts into a **highly engaging, soulful, and sales-oriented** System Prompt.

TARGET LANGUAGE: ${lang}

**YOUR MISSION:**
Create a system instruction that makes the AI sound like a **top-tier human employee**. It must be "saturated" (rich), persuasive, and helpful.

**STRUCTURE OF THE RESULTING PROMPT:**
1.  **👑 Identity**: Give the AI a specific role (e.g., "Caring Concierge"). Define a warm tone.
2.  **💎 The "Brain"**: Seamlessly integrate services & Unique Value.
3.  **🚀 Behavior**:
    * **Proactive Selling**: Suggest bookings/orders.
    * **Objection Handling**: Reassure doubts.
    * **Conciseness**: Short, punchy WhatsApp replies.
4.  **🛡️ Guardrails**: How to handle unknown prices or off-topic questions.

**OUTPUT:**
Return ONLY the RAW SYSTEM PROMPT TEXT. No markdown code blocks, no intros.
Make it **RICH**, **DETAILED**, and **ALIVE**.
`;

// --- SESSION STORAGE ---
const interviewSessions = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [sessionId, session] of interviewSessions.entries()) {
    if (now - session.timestamp > 2 * 60 * 60 * 1000)
      interviewSessions.delete(sessionId);
  }
}, 15 * 60 * 1000);

// ==========================================
// API HANDLERS
// ==========================================

// 1. START
export async function startInterview(req, res) {
  try {
    const { deviceId, language = "en" } = req.body;
    if (!deviceId) return res.status(400).json({ error: "deviceId required" });

    const sessionId = `${deviceId}_${Date.now()}`;
    const firstQuestion = FIRST_QUESTIONS[language] || FIRST_QUESTIONS["en"];

    interviewSessions.set(sessionId, {
      deviceId,
      language,
      messages: [{ role: "assistant", content: firstQuestion }],
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
    res.status(500).json({ error: "Internal server error" });
  }
}

// 2. ANSWER
export async function answerQuestion(req, res) {
  try {
    const { sessionId, answer } = req.body;
    if (!sessionId || !answer)
      return res.status(400).json({ error: "Missing fields" });

    const session = interviewSessions.get(sessionId);
    if (!session) return res.status(404).json({ error: "Session not found" });

    session.messages.push({ role: "user", content: answer });
    session.timestamp = Date.now();
    const count = session.messages.filter((m) => m.role === "user").length;

    if (count >= 15) return finishInterview(res, session, sessionId, count);

    const response = await axios.post(
      GROQ_API_URL,
      {
        model: MODEL_NAME,
        messages: [
          {
            role: "system",
            content: GET_AI_INTERVIEWER_PROMPT(session.language),
          },
          ...session.messages,
        ],
        temperature: 0.7, // Чуть выше для "живости" диалога
        max_tokens: 512,
        response_format: { type: "json_object" },
      },
      { headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` } }
    );

    const content = response.data.choices[0].message.content;
    let aiResponse = extractJson(content);
    if (!aiResponse) aiResponse = { question: content, isComplete: false };

    if (
      aiResponse.isComplete ||
      (typeof aiResponse.question === "string" &&
        aiResponse.question.includes("INTERVIEW_COMPLETE"))
    ) {
      return finishInterview(res, session, sessionId, count);
    }

    session.messages.push({ role: "assistant", content: aiResponse.question });
    res.json({
      success: true,
      sessionId,
      question: aiResponse.question,
      questionNumber: count + 1,
      isComplete: false,
    });
  } catch (e) {
    console.error("[INTERVIEW] Error:", e.message);
    res.status(500).json({ error: "Failed to get question" });
  }
}

function finishInterview(res, session, sessionId, count) {
  const finalPhrases = {
    ru: "Супер! ✨ Я узнал всё, что нужно. Сейчас создам идеального ассистента... 🤖",
    en: "Awesome! ✨ I have everything I need. Creating your perfect assistant now... 🤖",
    tr: "Harika! ✨ Gerekli her şeyi öğrendim. Asistanınızı oluşturuyorum... 🤖",
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
    if (!session) return res.status(404).json({ error: "Session not found" });

    let isPro = false;
    try {
      const user = await User.findOne({
        where: { deviceId: session.deviceId },
      });
      if (user && user.isPro) isPro = true;
    } catch (e) {}

    const styleInstruction = isPro
      ? "MODE: PREMIUM. Create a highly detailed, persuasive, and psychologically advanced persona. Use rich formatting. Length: up to 1500 chars."
      : "MODE: STANDARD. Create a clear, professional, and helpful persona. Be concise but engaging. Length: up to 900 chars.";

    const transcript = session.messages
      .map((m) => `${m.role === "user" ? "Owner" : "AI"}: ${m.content}`)
      .join("\n\n");

    const response = await axios.post(
      GROQ_API_URL,
      {
        model: MODEL_NAME,
        messages: [
          {
            role: "system",
            content: GET_PROMPT_GENERATOR_SYSTEM(session.language),
          },
          { role: "system", content: styleInstruction },
          { role: "user", content: `TRANSCRIPT:\n${transcript}` },
        ],
        temperature: 0.75,
        max_tokens: 1800,
      },
      { headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` } }
    );

    res.json({
      success: true,
      prompt: response.data.choices[0].message.content.trim(),
      sessionId,
      isPro,
    });
  } catch (e) {
    console.error("[PROMPT_GEN] Error:", e.message);
    res.status(500).json({ error: "Generation failed" });
  }
}

// 4. REGENERATE
export async function regeneratePrompt(req, res) {
  try {
    const { sessionId } = req.body;
    const session = interviewSessions.get(sessionId);
    if (!session) return res.status(404).json({ error: "Session not found" });

    const transcript = session.messages
      .map((m) => `${m.role === "user" ? "Owner" : "AI"}: ${m.content}`)
      .join("\n\n");

    const response = await axios.post(
      GROQ_API_URL,
      {
        model: MODEL_NAME,
        messages: [
          {
            role: "system",
            content:
              GET_PROMPT_GENERATOR_SYSTEM(session.language) +
              "\n\nIMPORTANT: Try a DIFFERENT style. Make it more creative and engaging.",
          },
          { role: "user", content: `TRANSCRIPT:\n${transcript}` },
        ],
        temperature: 0.85,
        max_tokens: 1800,
      },
      { headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` } }
    );

    res.json({
      success: true,
      prompt: response.data.choices[0].message.content.trim(),
    });
  } catch (e) {
    console.error("[PROMPT_GEN] Regen error:", e.message);
    res.status(500).json({ error: "Failed to regenerate" });
  }
}

// 5. CANCEL
export async function cancelInterview(req, res) {
  const { sessionId } = req.body;
  if (sessionId) interviewSessions.delete(sessionId);
  res.json({ success: true });
}
