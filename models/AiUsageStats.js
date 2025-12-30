// models/AiUsageStats.js
import { DataTypes } from "sequelize";
import sequelize from "../config/db.js"; // если у тебя другой путь к инстансу — поправь здесь

const AiUsageStats = sequelize.define(
  "AiUsageStats",
  {
    deviceId: {
      type: DataTypes.STRING,
      allowNull: false,
      primaryKey: true,
    },
    monthKey: {
      // формат "2025-12"
      type: DataTypes.STRING(7),
      allowNull: false,
      primaryKey: true,
    },
    totalTokens: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    repliesCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    lastReplyAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    tableName: "ai_usage_stats",
    timestamps: true,
    indexes: [
      { fields: ["deviceId"] },
      { fields: ["monthKey"] },
      { fields: ["deviceId", "monthKey"] },
    ],
  }
);

export default AiUsageStats;
