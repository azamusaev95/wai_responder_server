// controllers/userController.js
import User from "../models/User.js";

const USE_FAKE_GOOGLE_PLAY = process.env.USE_FAKE_GOOGLE_PLAY === "true";

// Проверка активности подписки
const isSubscriptionActive = (user) => {
  if (!user.isPro) return false;
  if (!user.subscriptionExpires) return true; // Бессрочная
  return new Date() < new Date(user.subscriptionExpires);
};

// Обновить статус (проверить не истекла ли подписка)
const updateUserStatus = async (user) => {
  if (!isSubscriptionActive(user) && user.isPro) {
    user.isPro = false;
    await user.save();
  }
  return user;
};

// POST /api/user/init - Инициализация пользователя
const initUser = async (req, res) => {
  try {
    const { deviceId } = req.body;

    if (!deviceId) {
      return res.status(400).json({ error: "deviceId is required" });
    }

    const [user, created] = await User.findOrCreate({
      where: { deviceId },
      defaults: {
        deviceId,
        isPro: false,
      },
    });

    const updatedUser = await updateUserStatus(user);

    res.json({
      success: true,
      isNew: created,
      isPro: updatedUser.isPro,
      subscriptionExpiresAt: updatedUser.subscriptionExpires,
    });
  } catch (error) {
    console.error("Error in initUser:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// GET /api/user/status - Получить статус пользователя
const getStatus = async (req, res) => {
  try {
    const { deviceId } = req.query;

    if (!deviceId) {
      return res.status(400).json({ error: "deviceId is required" });
    }

    const user = await User.findOne({ where: { deviceId } });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const updatedUser = await updateUserStatus(user);

    res.json({
      success: true,
      isPro: updatedUser.isPro,
      subscriptionExpiresAt: updatedUser.subscriptionExpires,
    });
  } catch (error) {
    console.error("Error in getStatus:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// POST /api/user/verify-purchase - Верификация покупки и активация PRO
const verifyPurchase = async (req, res) => {
  try {
    const { deviceId, purchaseToken } = req.body;

    if (!deviceId || !purchaseToken) {
      return res.status(400).json({
        error: "deviceId and purchaseToken are required",
      });
    }

    const user = await User.findOne({ where: { deviceId } });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    let isValid = false;

    if (USE_FAKE_GOOGLE_PLAY) {
      console.log("🧪 Fake Google Play verification");
      isValid = purchaseToken.startsWith("fake_token_");
      if (isValid) {
        console.log("✅ Fake token accepted:", purchaseToken);
      }
    } else {
      console.log("🔐 Real Google Play verification");
      // TODO: Реализовать проверку через Google Play API
      // isValid = await verifyWithGooglePlayAPI(purchaseToken);
      isValid = false;
    }

    if (!isValid) {
      return res.status(400).json({
        error: "Invalid purchase token",
      });
    }

    // Активировать PRO
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // +30 дней

    user.isPro = true;
    user.subscriptionExpires = expiresAt;
    user.purchaseToken = purchaseToken;
    await user.save();

    console.log(`✅ PRO activated for device: ${deviceId}`);

    res.json({
      success: true,
      isPro: true,
      subscriptionExpiresAt: expiresAt,
      message: "PRO subscription activated!",
    });
  } catch (error) {
    console.error("Error in verifyPurchase:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export { initUser, getStatus, verifyPurchase };
