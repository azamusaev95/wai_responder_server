// controllers/promptGenerator.js
import axios from "axios";

// Шаблоны для быстрого старта
const BUSINESS_TEMPLATES = {
  food_delivery: {
    name: "Доставка еды",
    icon: "🍕",
    questions: [
      {
        id: "cuisine",
        question: "Какая кухня?",
        type: "text",
        placeholder: "Например: Итальянская, Азиатская, Фастфуд",
      },
      {
        id: "delivery_time",
        question: "Среднее время доставки?",
        type: "text",
        placeholder: "Например: 30-45 минут",
      },
      {
        id: "min_order",
        question: "Минимальная сумма заказа?",
        type: "text",
        placeholder: "Например: 500 сом",
      },
    ],
  },
  taxi: {
    name: "Такси/Трансфер",
    icon: "🚗",
    questions: [
      {
        id: "service_type",
        question: "Какие услуги предоставляете?",
        type: "multiselect",
        options: [
          "Городское такси",
          "Межгород",
          "Трансфер в аэропорт",
          "Грузоперевозки",
        ],
      },
      {
        id: "coverage",
        question: "Зона покрытия?",
        type: "text",
        placeholder: "Например: Бишкек и пригород",
      },
      {
        id: "features",
        question: "Особенности?",
        type: "multiselect",
        options: [
          "Работаем 24/7",
          "Безналичная оплата",
          "Детские кресла",
          "Комфортные авто",
        ],
      },
    ],
  },
  cleaning: {
    name: "Клининг",
    icon: "🧹",
    questions: [
      {
        id: "service_types",
        question: "Какие виды уборки предлагаете?",
        type: "multiselect",
        options: [
          "Квартиры",
          "Офисы",
          "После ремонта",
          "Генеральная уборка",
          "Поддерживающая уборка",
        ],
      },
      {
        id: "pricing",
        question: "Как формируется цена?",
        type: "text",
        placeholder: "Например: От 1500 сом за 2-комнатную квартиру",
      },
      {
        id: "features",
        question: "Ваши преимущества?",
        type: "multiselect",
        options: [
          "Профессиональное оборудование",
          "Эко-средства",
          "Быстрый выезд",
          "Гарантия качества",
        ],
      },
    ],
  },
  beauty: {
    name: "Салон красоты",
    icon: "💄",
    questions: [
      {
        id: "services",
        question: "Какие услуги предоставляете?",
        type: "multiselect",
        options: [
          "Стрижка",
          "Окрашивание",
          "Маникюр/Педикюр",
          "Макияж",
          "Массаж",
          "Косметология",
        ],
      },
      {
        id: "target",
        question: "Для кого ваши услуги?",
        type: "multiselect",
        options: ["Женщины", "Мужчины", "Дети"],
      },
      {
        id: "booking",
        question: "Как записываться?",
        type: "text",
        placeholder: "Например: По телефону или онлайн",
      },
    ],
  },
  real_estate: {
    name: "Недвижимость",
    icon: "🏠",
    questions: [
      {
        id: "service_type",
        question: "Что предлагаете?",
        type: "multiselect",
        options: ["Продажа", "Аренда", "Посуточная аренда"],
      },
      {
        id: "property_types",
        question: "Тип недвижимости?",
        type: "multiselect",
        options: ["Квартиры", "Дома", "Коммерческая недвижимость", "Участки"],
      },
      {
        id: "location",
        question: "Где находится недвижимость?",
        type: "text",
        placeholder: "Например: Бишкек, разные районы",
      },
    ],
  },
  online_store: {
    name: "Интернет-магазин",
    icon: "📦",
    questions: [
      {
        id: "products",
        question: "Что продаете?",
        type: "text",
        placeholder: "Например: Одежда, электроника, косметика",
      },
      {
        id: "delivery",
        question: "Условия доставки?",
        type: "text",
        placeholder: "Например: Доставка по городу бесплатно от 2000 сом",
      },
      {
        id: "payment",
        question: "Способы оплаты?",
        type: "multiselect",
        options: ["Наличные", "Картой", "Онлайн-оплата", "Рассрочка"],
      },
    ],
  },
  custom: {
    name: "Свой вариант",
    icon: "✏️",
    questions: [
      {
        id: "business_description",
        question: "Опишите ваш бизнес",
        type: "textarea",
        placeholder: "Расскажите чем занимаетесь, что предлагаете...",
      },
      {
        id: "target_audience",
        question: "Ваша целевая аудитория?",
        type: "text",
        placeholder: "Например: Молодые семьи, предприниматели, студенты",
      },
      {
        id: "key_features",
        question: "Главные преимущества?",
        type: "textarea",
        placeholder: "Что отличает вас от конкурентов?",
      },
    ],
  },
};

// Общие вопросы для всех типов
const COMMON_QUESTIONS = [
  {
    id: "language",
    question: "На каком языке должен отвечать ассистент?",
    type: "select",
    options: [
      { value: "auto", label: "Авто-определение (отвечать на языке клиента)" },
      { value: "ru", label: "Только русский" },
      { value: "ky", label: "Только кыргызский" },
    ],
    default: "auto",
  },
  {
    id: "tone",
    question: "Стиль общения?",
    type: "select",
    options: [
      { value: "friendly", label: "Дружелюбный и неформальный" },
      { value: "professional", label: "Профессиональный" },
      { value: "warm_professional", label: "Профессиональный но тёплый" },
      { value: "minimal", label: "Минималистичный (только факты)" },
    ],
    default: "friendly",
  },
  {
    id: "additional_info",
    question: "Дополнительные инструкции (опционально)",
    type: "textarea",
    placeholder: "Есть ли что-то ещё, что должен знать ассистент?",
    optional: true,
  },
];

// Генерация промпта через AI
export async function generatePrompt(req, res) {
  try {
    const { businessType, answers } = req.body;

    if (!businessType || !answers) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Собираем контекст для AI
    const template = BUSINESS_TEMPLATES[businessType];
    const businessName = template?.name || "бизнес";

    // Формируем промпт для GPT
    const systemPrompt = `Ты — эксперт по созданию промптов для AI-ассистентов в WhatsApp. Твоя задача — создать ИДЕАЛЬНЫЙ системный промпт для бизнеса на основе данных пользователя.

ВАЖНЫЕ ПРАВИЛА:
1. Промпт должен быть на том языке, который выбрал пользователь
2. Промпт должен быть кратким но содержательным (200-500 символов)
3. Указывай конкретные детали о бизнесе
4. Определи правильный стиль общения
5. Упомяни ключевые особенности
6. НЕ используй фразы типа "Вы AI-ассистент" - пиши от лица бизнеса
7. Добавь инструкции о языке ответа

СТРУКТУРА ПРОМПТА:
- Кто мы (1 предложение)
- Что предлагаем (2-3 предложения с конкретикой)
- Как общаться (тон, стиль)
- Важные детали (цены, время, условия)
- Язык ответа

Создай промпт БЕЗ вводных слов, сразу текст промпта.`;

    const userMessage = `Тип бизнеса: ${businessName}

Ответы пользователя:
${Object.entries(answers)
  .map(([key, value]) => {
    if (Array.isArray(value)) {
      return `${key}: ${value.join(", ")}`;
    }
    return `${key}: ${value}`;
  })
  .join("\n")}

Создай системный промпт для этого бизнеса.`;

    // Вызываем OpenAI
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        temperature: 0.7,
        max_tokens: 500,
      },
      {
        timeout: 20000,
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const generatedPrompt =
      response?.data?.choices?.[0]?.message?.content?.trim() || "";

    if (!generatedPrompt) {
      throw new Error("Failed to generate prompt");
    }

    res.json({
      success: true,
      prompt: generatedPrompt,
    });
  } catch (e) {
    console.error("Error generating prompt:", e);
    const status = e?.response?.status || 500;
    const msg = e?.response?.data || { error: String(e?.message || e) };
    res.status(status).json({ error: msg });
  }
}

// Получить список шаблонов
export async function getTemplates(req, res) {
  try {
    const templates = Object.entries(BUSINESS_TEMPLATES).map(
      ([key, value]) => ({
        id: key,
        name: value.name,
        icon: value.icon,
      })
    );

    res.json({
      success: true,
      templates,
    });
  } catch (e) {
    console.error("Error getting templates:", e);
    res.status(500).json({ error: "Internal server error" });
  }
}

// Получить вопросы для конкретного типа бизнеса
export async function getQuestions(req, res) {
  try {
    const { businessType } = req.params;

    if (!businessType || !BUSINESS_TEMPLATES[businessType]) {
      return res.status(400).json({ error: "Invalid business type" });
    }

    const template = BUSINESS_TEMPLATES[businessType];

    res.json({
      success: true,
      businessName: template.name,
      icon: template.icon,
      specificQuestions: template.questions,
      commonQuestions: COMMON_QUESTIONS,
    });
  } catch (e) {
    console.error("Error getting questions:", e);
    res.status(500).json({ error: "Internal server error" });
  }
}
