// routes/user.js
import express from "express";

const router = express.Router();

import {
  initUser,
  getStatus,
  verifyPurchase,
  googleWebhook,
} from "../controllers/userController.js";

router.post("/init", initUser);
router.get("/status", getStatus);
router.post("/verify-purchase", verifyPurchase);

router.post("/google-webhook", googleWebhook);

export default router;
