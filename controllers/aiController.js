import axios from "axios";
import User from "../models/User.js";
import AiUsageStats from "../models/AiUsageStats.js";

const MODEL = "gpt-5-mini";

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
      isNegotiable: x.isNegotiable === true,
    }));

    return JSON.stringify(arr);
  } catch {
    return "[]";
  }
}

// ===== SUBSCRIPTION HELPERS =====

const isSubscriptionActive = (user) => {
  if (!user.isPro) return false;
  if (!user.subscriptionExpires) return true;
  return new Date() < new Date(user.subscriptionExpires);
};

const updateUserStatus = async (user) => {
  if (!isSubscriptionActive(user) && user.isPro) {
    user.isPro = false;
    await user.save();
  }
  return user;
};

const shouldResetMessages = (user) => {
  if (!user.messagesResetDate) return false;
  return new Date() >= new Date(user.messagesResetDate);
};

// ======================================================
// ===================== MAIN HANDLER ===================
// ======================================================

export async function aiReply(req, res) {
  try {
    const {
      systemPrompt = "You are a helpful assistant.",
      message = "",
      contact = { name: "Client", isGroup: false },
      catalog = [],
      temperature = 0.3,
      deviceId,
    } = req.body || {};

    let currentUser = null;

    // ===== LIMIT CHECK =====
    if (deviceId) {
      const user = await User.findOne({ where: { deviceId } });

      if (user) {
        const updatedUser = await updateUserStatus(user);
        currentUser = updatedUser;

        if (shouldResetMessages(updatedUser)) {
          const now = new Date();
          updatedUser.messagesThisMonth = 0;
          updatedUser.messagesResetDate = new Date(
            now.getTime() + 30 * 24 * 60 * 60 * 1000
          );
          await updatedUser.save();
        }

        const FREE_LIMIT = 50;

        if (!updatedUser.isPro && updatedUser.messagesThisMonth >= FREE_LIMIT) {
          return res.json({
            limitReached: true,
            reply: null,
            limit: {
              used: updatedUser.messagesThisMonth,
              total: FREE_LIMIT,
              isPro: false,
            },
          });
        }
      }
    }

    // ===== SAFETY PROMPT =====
    const modifiedSystemPrompt = `${systemPrompt}

SAFETY RULES:
- Do NOT provide professional Legal, Financial, or Medical advice.
- If the user asks about these topics, politely decline and recommend a specialist.
- Prefer to answer only questions related to this business, products and catalog.
- If required information is missing, politely say you don't know.
- Reply in the same language as the user.`;

    // ===== IGNORE EMPTY INPUT =====
    if (!message || String(message).trim() === "") {
      return res.json({
        reply: "",
        silence: true,
      });
    }

    // ===== PREPARE USER MESSAGE =====
    const userMessage = [
      `Contact: ${contact?.name ?? "Client"} (${
        contact?.isGroup ? "group" : "private"
      })`,
      `Message: "${String(message ?? "").slice(0, 2000)}"`,
    ];

    if (Array.isArray(catalog) && catalog.length > 0) {
      userMessage.push(`Catalog (JSON): ${formatCatalog(catalog)}`);
    }

    // ===== OPENAI REQUEST =====
    const resp = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: MODEL,
        messages: [
          { role: "system", content: modifiedSystemPrompt },
          { role: "user", content: userMessage.join("\n") },
        ],
        temperature: clamp(+temperature, 0, 1),
      },
      {
        timeout: 15000,
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const usage = resp?.data?.usage;
    const reply = resp?.data?.choices?.[0]?.message?.content?.trim() || "";

    // ===== TOKEN LOGGING =====
    if (deviceId && usage?.total_tokens) {
      try {
        const now = new Date();
        const monthKey = now.toISOString().slice(0, 7);

        const existing = await AiUsageStats.findOne({
          where: { deviceId, monthKey },
        });

        if (existing) {
          existing.totalTokens += usage.total_tokens;
          existing.repliesCount += 1;
          existing.lastReplyAt = now;
          await existing.save();
        } else {
          await AiUsageStats.create({
            deviceId,
            monthKey,
            totalTokens: usage.total_tokens,
            repliesCount: 1,
            lastReplyAt: now,
          });
        }
      } catch (logErr) {
        console.error(
          "[AI_USAGE] Failed to update ai_usage_stats:",
          logErr?.message || logErr
        );
      }
    }

    // ===== INCREMENT USER MESSAGE COUNT =====
    if (currentUser) {
      try {
        currentUser.messagesThisMonth += 1;
        await currentUser.save();
      } catch (counterErr) {
        console.error(
          "[AI_REPLY] Failed to increment messagesThisMonth:",
          counterErr?.message || counterErr
        );
      }
    }

    return res.json({
      reply,
      silence: false,
    });
  } catch (e) {
    console.error("OPENAI ERROR:", e?.response?.data || e?.message);

    const status = e?.response?.status || 500;
    const msg = e?.response?.data || { error: String(e?.message || e) };

    res.status(status).json({ error: msg });
  }
}
