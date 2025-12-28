// controllers/userController.js
import User from "../models/User.js";

const USE_FAKE_GOOGLE_PLAY = process.env.USE_FAKE_GOOGLE_PLAY === "true";

// Проверка активности подписки
const isSubscriptionActive = (user) => {
  if (!user.isPro) return false;
  if (!user.subscriptionExpires) return true; // Бессрочная
  return new Date() < new Date(user.subscriptionExpires);
};

// POST /api/user/init - Инициализация пользователя
const initUser = async (req, res) => {
  try {
    const { deviceId } = req.body;

    if (!deviceId) {
      return res.status(400).json({ error: "deviceId is required" });
    }

    const now = new Date();

    const [user, created] = await User.findOrCreate({
      where: { deviceId },
      defaults: {
        deviceId,
        isPro: false,
        messagesThisMonth: 0,
        messagesResetDate: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000), // +30 дней от создания
        createdAt: now,
      },
    });

    const updatedUser = await updateUserStatus(user);

    // Проверить, нужно ли сбросить счетчик сообщений (только для FREE)
    if (!updatedUser.isPro) {
      if (
        updatedUser.messagesResetDate &&
        now >= new Date(updatedUser.messagesResetDate)
      ) {
        // Прошло 30 дней - сбросить счетчик и установить новую дату
        updatedUser.messagesThisMonth = 0;
        updatedUser.messagesResetDate = new Date(
          now.getTime() + 30 * 24 * 60 * 60 * 1000
        );
        await updatedUser.save();
      }
    }

    // Вычислить оставшиеся сообщения для FREE
    const messagesRemaining = updatedUser.isPro
      ? null // для PRO - безлимит
      : Math.max(0, 50 - (updatedUser.messagesThisMonth || 0));

    res.json({
      success: true,
      isNew: created,
      isPro: updatedUser.isPro,
      subscriptionExpiresAt: updatedUser.subscriptionExpires,
      messagesThisMonth: updatedUser.messagesThisMonth || 0,
      messagesResetDate: updatedUser.messagesResetDate,
      messagesRemaining: messagesRemaining,
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
      return res.status(400).json({ error: "Missing required fields" });
    }

    const user = await User.findOne({ where: { deviceId } });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const now = new Date();

    // Активировать PRO на 30 дней от момента покупки
    user.isPro = true;
    user.subscriptionExpires = new Date(
      now.getTime() + 30 * 24 * 60 * 60 * 1000
    ); // +30 дней
    user.purchaseToken = purchaseToken;

    // Сбросить счетчик сообщений при активации PRO
    user.messagesThisMonth = 0;
    user.messagesResetDate = null; // для PRO не нужна дата сброса

    await user.save();

    res.json({
      success: true,
      isPro: true,
      subscriptionExpiresAt: user.subscriptionExpires,
      messagesRemaining: null, // безлимит
    });
  } catch (error) {
    console.error("Error in verifyPurchase:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

const updateUserStatus = async (user) => {
  const now = new Date();

  // Проверить, не истекла ли PRO подписка
  if (
    user.isPro &&
    user.subscriptionExpires &&
    now >= new Date(user.subscriptionExpires)
  ) {
    user.isPro = false;
    user.subscriptionExpires = null;

    // Восстановить FREE лимиты
    user.messagesThisMonth = 0;
    user.messagesResetDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    await user.save();
  }

  return user;
};

const googleWebhook = async (req, res) => {
  try {
    // Данные приходят в формате base64
    const data = req.body.message.data;
    const decoded = JSON.parse(Buffer.from(data, "base64").toString());

    console.log("[RTDN] Получено тестовое или реальное уведомление:", decoded);

    // Если это реальное продление (notificationType === 2)
    const { purchaseToken, notificationType } =
      decoded.subscriptionNotification || {};
    if (purchaseToken && notificationType === 2) {
      const user = await User.findOne({ where: { purchaseToken } });
      if (user) {
        const newExpire = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        await user.update({ isPro: true, subscriptionExpires: newExpire });
        console.log(`[RTDN] Подписка для ${user.deviceId} продлена!`);
      }
    }

    // Обязательно шлем 200 OK
    res.status(200).send("OK");
  } catch (err) {
    console.error("[RTDN] Ошибка:", err.message);
    res.status(200).send("OK");
  }
};

export { initUser, getStatus, verifyPurchase, googleWebhook };
