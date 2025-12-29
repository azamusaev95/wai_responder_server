// app.js
import "dotenv/config";
import express from "express";
import cors from "cors";
import { aiReply } from "./controllers/aiController.js";
import userRoutes from "./routes/user.js";
import sequelize from "./config/db.js";
import promptGeneratorRoutes from "./routes/promptGenerator.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "256kb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

app.post("/ai/reply", aiReply);
app.use("/api/user", userRoutes);

app.use("/api/prompt-generator", promptGeneratorRoutes);

const PORT = process.env.PORT || 8787;

async function start() {
  try {
    console.log("⏳ Connecting to DB...");
    await sequelize.authenticate();
    console.log("✅ DB connection OK");

    console.log("⏳ Sync models (sequelize.sync)...");
    // await sequelize.sync({ alter: true }); // авто-создание/обновление таблиц
    console.log("✅ Models synced");

    app.listen(PORT, () => {
      console.log(`🚀 AI proxy listening on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("❌ DB init error:", err);
    process.exit(1);
  }
}

start();

export default app;
