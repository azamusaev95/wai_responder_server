// models/SubscriptionEvent.js
import { DataTypes } from "sequelize";
import sequelize from "../db.js"; // поправь путь, как у тебя подключён sequelize
import User from "./User.js";

const SubscriptionEvent = sequelize.define(
  "SubscriptionEvent",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },

    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    deviceId: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    purchaseToken: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    eventType: {
      // например: "RTDN_CANCEL_OR_EXPIRE", "RTDN_PURCHASED", ...
      type: DataTypes.STRING,
      allowNull: false,
    },

    source: {
      // "googleWebhook" / "verifyPurchase" (на будущее)
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "googleWebhook",
    },

    notificationType: {
      // число 1,2,3,4,10,11,12...
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    rawPayload: {
      // опционально, если захочешь логировать JSON целиком
      type: DataTypes.JSONB || DataTypes.JSON, // в зависимости от БД
      allowNull: true,
    },
  },
  {
    tableName: "SubscriptionEvents",
    timestamps: true, // createdAt / updatedAt
  }
);

// ассоциация (если используешь)
SubscriptionEvent.belongsTo(User, { foreignKey: "userId" });

export default SubscriptionEvent;
