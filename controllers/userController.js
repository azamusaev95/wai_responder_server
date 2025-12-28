import User from "../models/User.js";

// Вспомогательная функция для логирования (будет видна в Railway)
const log = (tag, message, data = "") => {
  const timestamp = new Date().toISOString();
  console.log(
    `[${timestamp}] [${tag}] ${message}`,
    data ? JSON.stringify(data, null, 2) : ""
  );
};

// ==========================================================
// POST /api/user/init - Инициализация пользователя
// ==========================================================
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

    // Проверяем срок подписки и обновляем статус при необходимости
    const updatedUser = await updateUserStatus(user);

    // Проверка сброса счетчика сообщений (для FREE)
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
      messagesRemaining,
    });
  } catch (error) {
    log("INIT-ERROR", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

// ==========================================================
// GET /api/user/status - Получить статус пользователя
// ==========================================================
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

// ==========================================================
// POST /api/user/verify-purchase - Верификация покупки
// вызывается ПРИЛОЖЕНИЕМ после requestSubscription
// ==========================================================
const verifyPurchase = async (req, res) => {
  try {
    // 1. Логируем сырое тело и тип
    log("VERIFY-RAW-BODY", "Тело запроса verify-purchase (raw):", {
      type: typeof req.body,
      body: req.body,
    });

    // 2. Пробуем аккуратно распарсить
    let parsedBody = req.body;

    // Если body строка — пробуем JSON.parse
    if (typeof parsedBody === "string") {
      try {
        parsedBody = JSON.parse(parsedBody);
        log("VERIFY-PARSED", "req.body был строкой, распарсили:", parsedBody);
      } catch (e) {
        log(
          "VERIFY-PARSE-ERROR",
          "Не удалось распарсить body как JSON:",
          parsedBody
        );
        return res
          .status(400)
          .json({ error: "Invalid JSON in request body for verify-purchase" });
      }
    }

    // Если почему-то null/undefined — считаем, что это ошибка
    if (!parsedBody || typeof parsedBody !== "object") {
      log(
        "VERIFY-BAD-BODY",
        "parsedBody не объект после обработки:",
        parsedBody
      );
      return res
        .status(400)
        .json({ error: "Bad request body for verify-purchase" });
    }

    // 3. Уже из parsedBody достаём поля
    const { deviceId, purchaseToken, token, productId } = parsedBody;
    const finalToken = purchaseToken || token;

    log("VERIFY-START", "Данные покупки (parsed):", {
      deviceId,
      productId,
      purchaseToken: finalToken,
    });

    // 4. Проверка обязательных полей
    if (!deviceId || !finalToken) {
      log("VERIFY-FAILED", "Отсутствует deviceId или purchaseToken", {
        deviceId,
        finalToken,
        parsedBody,
      });
      return res.status(400).json({ error: "Missing required fields" });
    }

    // 5. Ищем пользователя и активируем PRO
    const user = await User.findOne({ where: { deviceId } });

    if (!user) {
      log("VERIFY-FAILED", "Пользователь не найден в БД при покупке", {
        deviceId,
      });
      return res.status(404).json({ error: "User not found in database" });
    }

    const now = new Date();

    user.isPro = true;
    user.subscriptionExpires = new Date(
      now.getTime() + 30 * 24 * 60 * 60 * 1000
    );
    user.purchaseToken = finalToken;
    user.messagesThisMonth = 0;
    user.messagesResetDate = null;

    await user.save();
    log(
      "VERIFY-SUCCESS",
      `PRO активирован для ${deviceId} до ${user.subscriptionExpires}`,
      { purchaseToken: finalToken }
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

// ==========================================================
// Вспомогательная функция: обновление статуса при истечении
// ==========================================================
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

// ==========================================================
// POST /api/user/google-webhook - Вебхук от Google Play (RTDN)
// сюда шлёт САМ GOOGLE, не приложение
// ==========================================================
const googleWebhook = async (req, res) => {
  try {
    const message = req.body?.message;
    if (!message || !message.data) {
      log("RTDN-ERROR", "Нет message.data в webhook", req.body);
      return res.status(200).send("OK");
    }

    const decoded = JSON.parse(Buffer.from(message.data, "base64").toString());
    log("RTDN-RECEIVED", "Уведомление от Google (decoded):", decoded);

    // Универсальный парсинг purchaseToken и notificationType
    let purchaseToken;
    let notificationType;

    if (decoded.subscriptionNotification) {
      purchaseToken = decoded.subscriptionNotification.purchaseToken;
      notificationType = decoded.subscriptionNotification.notificationType;
    }

    // Фоллбэк: некоторые RTDN содержат purchaseToken и notificationType на верхнем уровне
    if (!purchaseToken && decoded.purchaseToken) {
      purchaseToken = decoded.purchaseToken;
    }
    if (
      (notificationType === undefined || notificationType === null) &&
      decoded.notificationType !== undefined
    ) {
      notificationType = decoded.notificationType;
    }

    if (!purchaseToken) {
      log(
        "RTDN-WARN",
        "Не удалось извлечь purchaseToken из уведомления",
        decoded
      );
      return res.status(200).send("OK");
    }

    const user = await User.findOne({ where: { purchaseToken } });

    if (!user) {
      log("RTDN-WARN", "Пользователь с этим токеном не найден в базе.", {
        purchaseToken,
      });
      return res.status(200).send("OK");
    }

    // 1 (PURCHASED), 2 (RENEWED), 4 (RECOVERED) - активация/продление
    if ([1, 2, 4].includes(Number(notificationType))) {
      const newExpire = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      await user.update({ isPro: true, subscriptionExpires: newExpire });
      log(
        "RTDN-SUCCESS",
        `Статус обновлен для ${user.deviceId}, тип: ${notificationType}`,
        { newExpire }
      );
    }
    // 3 (CANCELED), 12 (EXPIRED) - отключение
    else if ([3, 12].includes(Number(notificationType))) {
      await user.update({ isPro: false });
      log("RTDN-CANCEL", `Подписка отключена для ${user.deviceId}`, {
        notificationType,
      });
    } else {
      log("RTDN-INFO", "Необработанный notificationType", {
        notificationType,
      });
    }

    res.status(200).send("OK");
  } catch (err) {
    log("RTDN-ERROR", err.message);
    // RTDN всегда ждёт 200, даже если у нас ошибка
    res.status(200).send("OK");
  }
};

export { initUser, getStatus, verifyPurchase, googleWebhook };
