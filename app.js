import "dotenv/config";
import express from "express";
import cors from "cors";
import { aiReply } from "./controllers/aiController.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "256kb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

app.post("/ai/reply", aiReply);

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => {
  console.log(`🚀 AI proxy listening on http://localhost:${PORT}`);
});

export default app;
