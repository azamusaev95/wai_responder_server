import axios from "axios";

function clamp(v, lo, hi) {
  if (typeof v !== "number" || Number.isNaN(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
}

function formatCatalog(items = []) {
  try {
    const arr = (Array.isArray(items) ? items : []).slice(0, 100).map((x) => ({
      name: String(x.name ?? "").slice(0, 64),
      description: String(x.description ?? "").slice(0, 240),
      price: Number.isFinite(+x.price) ? +x.price : undefined,
    }));
    return JSON.stringify(arr);
  } catch {
    return "[]";
  }
}

export async function aiReply(req, res) {
  try {
    const {
      model = "gpt-4o-mini",
      systemPrompt = "Отвечай кратко и по делу.",
      message = "",
      lang = "ru",
      contact = { name: "Клиент", isGroup: false },
      catalog = [],
      temperature = 0.3,
      maxTokens = 256,
    } = req.body || {};

    const sys = [
      systemPrompt,
      "Правила: 1) 1–3 предложения, 2) без Markdown, 3) язык ответа = язык сообщения, 4) не выдумывай факты.",
      "Если уместно, ссылайся на товары/услуги из каталога.",
    ].join("\n");

    const user = [
      `Язык: ${lang}`,
      `Контакт: ${contact?.name ?? "Клиент"} (${
        contact?.isGroup ? "группа" : "личка"
      })`,
      `Сообщение: "${String(message ?? "").slice(0, 2000)}"`,
      `Каталог JSON: ${formatCatalog(catalog)}`,
      "Дай короткий, вежливый и полезный ответ.",
    ].join("\n");

    const resp = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
        temperature: clamp(+temperature, 0, 1),
        max_tokens: clamp(+maxTokens, 16, 1024),
      },
      {
        timeout: 15000,
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const reply = resp?.data?.choices?.[0]?.message?.content?.trim() || "";
    res.json({ reply });
  } catch (e) {
    const status = e?.response?.status || 500;
    const msg = e?.response?.data || { error: String(e?.message || e) };
    res.status(status).json({ error: msg });
  }
}
