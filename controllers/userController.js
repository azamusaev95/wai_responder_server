import User from "../models/User.js";

// Вспомогательная функция для логирования (будет видна в Railway)
const log = (tag, message, data = "") => {
  const timestamp = new Date().toISOString();
  console.log(
    `[${timestamp}] [${tag}] ${message}`,
    data ? JSON.stringify(data, null, 2) : ""
  );
};

// POST /api/user/init - Инициализация пользователя
const initUser = async (req, res) => {
  try {
    const { deviceId } = req.body;
    log("INIT", "Запрос инициализации для deviceId:", deviceId);

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
        messagesResetDate: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        createdAt: now,
      },
    });

    log(
      "INIT",
      created ? "Создан новый пользователь" : "Пользователь найден в базе"
    );

    const updatedUser = await updateUserStatus(user);

    // Проверить сброс счетчика сообщений (для FREE)
    if (!updatedUser.isPro) {
      if (
        updatedUser.messagesResetDate &&
        now >= new Date(updatedUser.messagesResetDate)
      ) {
        log("INIT", "Сброс счетчика сообщений по истечении 30 дней");
        updatedUser.messagesThisMonth = 0;
        updatedUser.messagesResetDate = new Date(
          now.getTime() + 30 * 24 * 60 * 60 * 1000
        );
        await updatedUser.save();
      }
    }

    const messagesRemaining = updatedUser.isPro
      ? null
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
    log("INIT-ERROR", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

// GET /api/user/status - Получить статус пользователя
const getStatus = async (req, res) => {
  try {
    const { deviceId } = req.query;
    log("STATUS-GET", "Проверка статуса для:", deviceId);

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
    log("STATUS-ERROR", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

// POST /api/user/verify-purchase - Верификация покупки
const verifyPurchase = async (req, res) => {
  try {
    const { deviceId, purchaseToken } = req.body;
    log("VERIFY-START", "Данные покупки:", { deviceId, purchaseToken });

    if (!deviceId || !purchaseToken) {
      log("VERIFY-FAILED", "Отсутствует deviceId или purchaseToken");
      return res.status(400).json({ error: "Missing required fields" });
    }

    const user = await User.findOne({ where: { deviceId } });

    if (!user) {
      log("VERIFY-FAILED", "Пользователь не найден в БД при покупке");
      return res.status(404).json({ error: "User not found in database" });
    }

    const now = new Date();

    // Активируем PRO
    user.isPro = true;
    user.subscriptionExpires = new Date(
      now.getTime() + 30 * 24 * 60 * 60 * 1000
    );
    user.purchaseToken = purchaseToken;
    user.messagesThisMonth = 0;
    user.messagesResetDate = null;

    await user.save();
    log(
      "VERIFY-SUCCESS",
      `PRO активирован для ${deviceId} до ${user.subscriptionExpires}`
    );

    res.json({
      success: true,
      isPro: true,
      subscriptionExpiresAt: user.subscriptionExpires,
      messagesRemaining: null,
    });
  } catch (error) {
    log("VERIFY-CRITICAL", error.message);
    res.status(500).json({ error: "Server database error: " + error.message });
  }
};

// Обновление статуса (проверка истечения)
const updateUserStatus = async (user) => {
  const now = new Date();

  if (
    user.isPro &&
    user.subscriptionExpires &&
    now >= new Date(user.subscriptionExpires)
  ) {
    log(
      "AUTO-CHECK",
      `Подписка истекла для ${user.deviceId}. Возврат на FREE.`
    );
    user.isPro = false;
    user.subscriptionExpires = null;
    user.messagesThisMonth = 0;
    user.messagesResetDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    await user.save();
  }

  return user;
};

// POST /api/user/google-webhook - Вебхук от Google Play
const googleWebhook = async (req, res) => {
  try {
    const data = req.body.message.data;
    const decoded = JSON.parse(Buffer.from(data, "base64").toString());
    log("RTDN-RECEIVED", "Уведомление от Google:", decoded);

    const { purchaseToken, notificationType } =
      decoded.subscriptionNotification || {};

    if (purchaseToken) {
      const user = await User.findOne({ where: { purchaseToken } });

      if (!user) {
        log("RTDN-WARN", "Пользователь с этим токеном не найден в базе.");
        return res.status(200).send("OK");
      }

      // 1 (Purchase), 2 (Renewed), 4 (Recovered) - Активация
      if ([1, 2, 4].includes(notificationType)) {
        const newExpire = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        await user.update({ isPro: true, subscriptionExpires: newExpire });
        log(
          "RTDN-SUCCESS",
          `Статус обновлен для ${user.deviceId}, тип: ${notificationType}`
        );
      }
      // 3 (Canceled), 12 (Expired) - Отключение
      else if ([3, 12].includes(notificationType)) {
        await user.update({ isPro: false });
        log("RTDN-CANCEL", `Подписка отключена для ${user.deviceId}`);
      }
    }

    res.status(200).send("OK");
  } catch (err) {
    log("RTDN-ERROR", err.message);
    res.status(200).send("OK");
  }
};

export { initUser, getStatus, verifyPurchase, googleWebhook };
