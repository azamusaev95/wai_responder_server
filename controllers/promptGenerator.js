// Импорт
import { FIRST_QUESTIONS } from "../constants/firstQuestions.js";

// В функции startInterview:
export async function startInterview(req, res) {
  try {
    const { deviceId, language = "en" } = req.body;

    // ... проверки deviceId ...

    const sessionId = `${deviceId}_${Date.now()}`;

    // ⚡ БЕРЕМ ГОТОВЫЙ ВОПРОС ПО КОДУ ЯЗЫКА ⚡
    // Если языка нет в списке, берем английский ('en')
    const firstQuestion = FIRST_QUESTIONS[language] || FIRST_QUESTIONS["en"];

    interviewSessions.set(sessionId, {
      deviceId,
      language,
      messages: [
        {
          role: "assistant",
          content: firstQuestion, // ИСПОЛЬЗУЕМ ГОТОВЫЙ ТЕКСТ
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
    // ...
  }
}
