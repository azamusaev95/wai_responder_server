// routes/promptGenerator.js
import express from "express";
import {
  startInterview,
  answerQuestion,
  generatePromptFromInterview,
  regeneratePrompt,
  cancelInterview,
} from "../controllers/promptGenerator.js";

const router = express.Router();

// Начать интервью
router.post("/interview/start", startInterview);

// Ответить на вопрос
router.post("/interview/answer", answerQuestion);

// Сгенерировать промпт
router.post("/interview/generate", generatePromptFromInterview);

// Регенерировать промпт (другой вариант)
router.post("/interview/regenerate", regeneratePrompt);

// Отменить интервью
router.post("/interview/cancel", cancelInterview);

export default router;
