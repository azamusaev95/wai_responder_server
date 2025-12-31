import axios from "axios";
import User from "../models/User.js";
import { FIRST_QUESTIONS } from "../constants/firstQuestions.js";

// ✅ CONFIGURATION FOR GROQ
const MODEL_NAME = "llama-3.3-70b-versatile";
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

// --- HELPER: Extract JSON from Llama response ---
function extractJson(text) {
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end !== -1) {
      return JSON.parse(text.substring(start, end + 1));
    }
    return JSON.parse(text); // Try parsing directly if no braces found
  } catch (e) {
    return null;
  }
}

// --- 1. PROMPT FOR AI INTERVIEWER ---
const GET_AI_INTERVIEWER_PROMPT = (lang) => `
You are an expert business analyst.
Your task is to conduct a structured interview to build an AI chatbot for a business.

CURRENT LANGUAGE: ${lang} (You must conduct the interview in this language!)

OBJECTIVES:
1. **Business Core**: What do they do? (Shop, Dentist, Lawyer, etc.)
2. **Unique Value**: Why choose them?
3. **Logistics**: Delivery areas/costs (SKIP for services).
4. **Operations**: Address, Hours.
5. **Payment**: Methods and specific details.
6. **Contacts**: Phone, Socials.
7. **Tone**: Friendly, formal, etc.

RULES:
- Ask ONE question at a time.
- If they are a service, DO NOT ask about delivery.
- If you have enough info, return "INTERVIEW_COMPLETE".

RESPONSE FORMAT:
You must return ONLY a JSON object. Do not write anything else.
{
  "question": "Your next question here in ${lang}",
  "isComplete": false
}

If the interview is finished, set "isComplete": true.
`;

// --- 2. PROMPT FOR GENERATOR ---
const GET_PROMPT_GENERATOR_SYSTEM = (lang) => `
You are an expert AI Prompt Engineer.
Write a SYSTEM PROMPT for a WhatsApp AI Assistant based on the interview transcript.

TARGET LANGUAGE: ${lang}

STRUCTURE:
1. **Role**: Define who the AI is.
2. **Business Context**: Summary.
3. **Knowledge Base**: Services, Address, Contacts, Payment.
4. **Behavior**: "If asked about X, say Y".

OUTPUT:
Return ONLY the raw text of the system prompt. No introduction.
`;

// --- SESSION STORAGE ---
const interviewSessions = new Map();

// Cleanup old sessions
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
    console.error("[INTERVIEW] Start error:", e);
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

    // Hard limit to prevent loops
    if (questionCount >= 15) {
      return finishInterview(res, session, sessionId, questionCount);
    }

    // Call Groq Llama 3.3
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
        temperature: 0.6,
        max_tokens: 512,
        response_format: { type: "json_object" }, // Llama supports JSON mode
      },
      {
        headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      }
    );

    const content = response.data.choices[0].message.content;
    let aiResponse = extractJson(content);

    // Fallback if JSON parsing fails
    if (!aiResponse) {
      aiResponse = { question: content, isComplete: false };
    }

    if (
      aiResponse.isComplete ||
      (typeof aiResponse.question === "string" &&
        aiResponse.question.includes("INTERVIEW_COMPLETE"))
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
    console.error("[INTERVIEW] Answer error:", e?.response?.data || e.message);
    res.status(500).json({ error: "Failed to get next question" });
  }
}

// Helper to finish
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
      ? "Make the prompt detailed and comprehensive (up to 1300 chars)."
      : "STRICT LIMIT: Keep under 900 chars. Focus on essentials.";

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
          { role: "system", content: lengthInstruction },
          { role: "user", content: `Interview Transcript:\n${transcript}` },
        ],
        temperature: 0.7,
        max_tokens: 1500,
      },
      {
        headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
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
    console.error("[PROMPT_GEN] Error:", e?.response?.data || e.message);
    res.status(500).json({ error: "Generation failed" });
  }
}

// 4. REGENERATE PROMPT
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
              "\n\nIMPORTANT: Create a DIFFERENT version. Re-phrase instructions.",
          },
          { role: "user", content: `Transcript:\n${transcript}` },
        ],
        temperature: 0.8, // Higher temp for variety
        max_tokens: 1500,
      },
      { headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` } }
    );

    res.json({
      success: true,
      prompt: response.data.choices[0].message.content.trim(),
    });
  } catch (e) {
    console.error("[PROMPT_GEN] Regen error:", e?.message);
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
