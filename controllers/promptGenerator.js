import axios from "axios";
import User from "../models/User.js";
// Make sure this path is correct relative to your folder structure
import { FIRST_QUESTIONS } from "../constants/firstQuestions.js";

// --- Prompts ---
const GET_AI_INTERVIEWER_PROMPT = (lang) => `
You are an expert at creating prompts for WhatsApp AI assistants.
Your task is to conduct a short interview (8-12 questions) with a business owner.

INTERVIEW LANGUAGE: ${lang} (MUST write only in this language!)

YOUR GOAL - understand:
1. What the business does
2. Key features and benefits
3. Delivery (if applicable)
4. Contact details (address, schedule, payment, requisites)
5. Communication style

RULES:
- Ask ONE specific question at a time.
- Be friendly, use emojis.
- If the user speaks another language, switch to it.
- After 8-12 questions, return EXACTLY the phrase: "INTERVIEW_COMPLETE".

RESPONSE FORMAT (JSON):
{
  "question": "Your question in ${lang}",
  "isComplete": false
}
`;

const GET_PROMPT_GENERATOR_SYSTEM = (lang) => `
Based on the interview, create the IDEAL system prompt for a WhatsApp AI assistant.

PROMPT LANGUAGE: ${lang} (The entire prompt text must be in this language!)

STRUCTURE:
1. Role and Offer
2. Key Benefits
3. Delivery/Service Area (if applicable)
4. CONTACTS & PAYMENT (Address, Schedule, Requisites - copy exactly)
5. Tone of voice

Return ONLY the prompt text. No intros.
`;

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

// --- 1. START INTERVIEW ---
export async function startInterview(req, res) {
  try {
    const { deviceId, language = "en" } = req.body;

    if (!deviceId) {
      return res.status(400).json({ error: "deviceId is required" });
    }

    const sessionId = `${deviceId}_${Date.now()}`;

    // Get the static translated message
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

// --- 2. ANSWER QUESTION ---
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

    // Question limit
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

// Helper function
function finishInterview(res, session, sessionId, count) {
  const finalMsg =
    session.language === "ru"
      ? "Отлично! Я собрал всю информацию. Генерирую промпт... ✨"
      : "Great! I have all the info. Generating your prompt... ✨";

  session.messages.push({ role: "assistant", content: finalMsg });

  return res.json({
    success: true,
    sessionId,
    question: finalMsg,
    questionNumber: count + 1,
    isComplete: true,
  });
}

// --- 3. GENERATE PROMPT ---
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
    } catch (e) {
      console.error(e);
    }

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

// --- 4. REGENERATE PROMPT ---
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
              "\n\nCreate a DIFFERENT version (change tone/structure).",
          },
          {
            role: "user",
            content: `Based on previous interview.`,
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

// --- 5. CANCEL ---
export async function cancelInterview(req, res) {
  const { sessionId } = req.body;
  if (sessionId && interviewSessions.has(sessionId)) {
    interviewSessions.delete(sessionId);
  }
  res.json({ success: true });
}
