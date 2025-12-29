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
// ==========================================================
// POST /api/user/verify-purchase - Верификация покупки
// вызывается ПРИЛОЖЕНИЕМ после requestSubscription
// ==========================================================
const verifyPurchase = async (req, res) => {
  try {
    // 0. Что реально пришло в Express
    log("VERIFY-ENTRY", "req.body как пришло в Express:", req.body);

    // 1. Логируем сырое тело и тип
    log("VERIFY-RAW-BODY", "Тело запроса verify-purchase (raw):", {
      type: typeof req.body,
      body: req.body,
    });

    // 2. Пробуем аккуратно распарсить
    let parsedBody = req.body;

    // 2.1. Если тело почему-то завернули в { body: {...} } — распакуем
    if (parsedBody && typeof parsedBody === "object" && parsedBody.body) {
      log(
        "VERIFY-UNWRAP",
        "Обнаружен parsedBody.body, распаковываем",
        parsedBody
      );
      parsedBody = parsedBody.body;
    }

    // 2.2. Если body строка — пробуем JSON.parse
    if (typeof parsedBody === "string") {
      try {
        parsedBody = JSON.parse(parsedBody);
        log(
          "VERIFY-PARSED",
          "req.body был строкой, распарсили в объект:",
          parsedBody
        );
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

    // 2.3. Проверяем, что в итоге у нас объект
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

    // 2.4. Лог финального тела после всех манипуляций
    log("VERIFY-BODY-PARSED", "parsedBody после обработки:", parsedBody);

    // 3. Достаём поля
    const { deviceId, purchaseToken, token, productId } = parsedBody;
    const finalToken = purchaseToken || token;
    const hasToken = !!finalToken;

    log(
      "VERIFY-START",
      hasToken
        ? "Данные покупки (parsed), токен есть ✅"
        : "Данные покупки (parsed), токена нет ⚠️",
      {
        deviceId,
        productId,
        purchaseToken: finalToken || null,
      }
    );

    // 4. Проверка обязательных полей
    if (!deviceId || !finalToken) {
      log("VERIFY-FAILED", "Отсутствует deviceId или purchaseToken", {
        deviceId,
        finalToken,
        parsedBody,
      });
      return res.status(400).json({ error: "Missing required fields" });
    }

    // 5. Ищем пользователя по deviceId
    const user = await User.findOne({ where: { deviceId } });

    if (!user) {
      log("VERIFY-FAILED", "Пользователь не найден в БД при покупке", {
        deviceId,
      });
      return res.status(404).json({ error: "User not found in database" });
    }

    // 6. Активируем PRO и сохраняем purchaseToken
    const now = new Date();

    user.isPro = true;
    user.subscriptionExpires = new Date(
      now.getTime() + 30 * 24 * 60 * 60 * 1000
    );
    user.purchaseToken = finalToken; // ВАЖНО: сохраняем токен для RTDN
    user.messagesThisMonth = 0;
    user.messagesResetDate = null;

    await user.save();

    log(
      "VERIFY-SUCCESS",
      `PRO активирован для ${deviceId} до ${user.subscriptionExpires}`,
      { purchaseToken: finalToken }
    );

    return res.json({
      success: true,
      isPro: true,
      subscriptionExpiresAt: user.subscriptionExpires,
      messagesRemaining: null,
    });
  } catch (error) {
    log("VERIFY-CRITICAL", error.message);
    return res.status(500).json({
      error: "Server database error: " + error.message,
    });
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

    const typeNum = Number(notificationType);
    const CANCEL_LIMIT = 3; // 1-я и 2-я отмены ок, на 3-ю — бан FREE

    switch (typeNum) {
      // 1 (PURCHASED) - первая покупка подписки
      case 1: {
        const newExpire = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

        await user.update({
          isPro: true,
          subscriptionExpires: newExpire,
        });

        log(
          "RTDN-SUCCESS",
          `SUBSCRIPTION PURCHASED для ${user.deviceId} (type=1)`,
          { newExpire, purchaseToken }
        );

        // логируем событие покупки (по желанию)
        await SubscriptionEvent.create({
          userId: user.id,
          deviceId: user.deviceId,
          purchaseToken,
          eventType: "RTDN_PURCHASED",
          source: "googleWebhook",
          notificationType: typeNum,
          rawPayload: decoded,
        });

        break;
      }

      // 2 (RENEWED) - успешное продление подписки
      case 2: {
        const newExpire = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

        await user.update({
          isPro: true,
          subscriptionExpires: newExpire,
        });

        log(
          "RTDN-SUCCESS",
          `SUBSCRIPTION RENEWED для ${user.deviceId} (type=2)`,
          { newExpire, purchaseToken }
        );

        await SubscriptionEvent.create({
          userId: user.id,
          deviceId: user.deviceId,
          purchaseToken,
          eventType: "RTDN_RENEWED",
          source: "googleWebhook",
          notificationType: typeNum,
          rawPayload: decoded,
        });

        break;
      }

      // 4 (RECOVERED) - подписка восстановлена после проблем с оплатой
      case 4: {
        const newExpire = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

        await user.update({
          isPro: true,
          subscriptionExpires: newExpire,
        });

        log(
          "RTDN-SUCCESS",
          `SUBSCRIPTION RECOVERED для ${user.deviceId} (type=4)`,
          { newExpire, purchaseToken }
        );

        await SubscriptionEvent.create({
          userId: user.id,
          deviceId: user.deviceId,
          purchaseToken,
          eventType: "RTDN_RECOVERED",
          source: "googleWebhook",
          notificationType: typeNum,
          rawPayload: decoded,
        });

        break;
      }

      // 3 (CANCELED) - отменена
      // 10 (PAUSED) - приостановлена (если включил в Play Console)
      // 11 (PAUSE_SCHEDULE_CHANGED) - изменён график паузы/отмены
      // 12 (EXPIRED) - окончательно истекла
      case 3:
      case 10:
      case 11:
      case 12: {
        // 1. Выключаем PRO
        await user.update({ isPro: false });

        // 2. Логируем событие
        await SubscriptionEvent.create({
          userId: user.id,
          deviceId: user.deviceId,
          purchaseToken,
          eventType: "RTDN_CANCEL_OR_EXPIRE",
          source: "googleWebhook",
          notificationType: typeNum,
          rawPayload: decoded,
        });

        // 3. Считаем, сколько уже было "плохих" событий
        const cancelCount = await SubscriptionEvent.count({
          where: {
            userId: user.id,
            eventType: "RTDN_CANCEL_OR_EXPIRE",
          },
        });

        // 4. Если это >= 3-я отмена/пауза/истечение — вырубаем FREE навсегда
        if (cancelCount >= CANCEL_LIMIT && !user.disableFreeTier) {
          await user.update({ disableFreeTier: true });

          log(
            "RTDN-ANTIFARM",
            `FREE заблокирован навсегда для ${user.deviceId}. Кол-во отмен/пауз/истечений: ${cancelCount}`,
            {
              userId: user.id,
              deviceId: user.deviceId,
              cancelCount,
              purchaseToken,
            }
          );
        }

        log(
          "RTDN-CANCEL",
          `SUBSCRIPTION DISABLED для ${user.deviceId} (type=${typeNum})`,
          { purchaseToken, cancelCount }
        );

        break;
      }

      // Любые другие типы, которые пока явно не используешь
      default: {
        log("RTDN-INFO", "Необработанный notificationType", {
          notificationType: typeNum,
          purchaseToken,
          deviceId: user.deviceId,
        });

        await SubscriptionEvent.create({
          userId: user.id,
          deviceId: user.deviceId,
          purchaseToken,
          eventType: "RTDN_UNKNOWN",
          source: "googleWebhook",
          notificationType: typeNum,
          rawPayload: decoded,
        });

        break;
      }
    }

    // RTDN всегда ждёт 200, даже если логика внутри что-то сделала не так
    res.status(200).send("OK");
  } catch (err) {
    log("RTDN-ERROR", err.message);
    // RTDN всегда ждёт 200, даже если у нас ошибка
    res.status(200).send("OK");
  }
};

export { initUser, getStatus, verifyPurchase, googleWebhook };
