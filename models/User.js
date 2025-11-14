// models/User.js
import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

const User = sequelize.define(
  "User",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },

    deviceId: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      field: "device_id",
    },

    isPro: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      allowNull: false,
      field: "is_pro",
    },

    subscriptionExpires: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "subscription_expires",
    },

    purchaseToken: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "purchase_token",
    },
    messagesThisMonth: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      allowNull: false,
      field: "messages_this_month",
    },

    messagesResetDate: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      allowNull: false,
      field: "messages_reset_date",
    },
  },

  {
    tableName: "users",
    timestamps: true,
    underscored: true,
    indexes: [
      {
        unique: true,
        fields: ["device_id"],
      },
    ],
  }
);

export default User;
