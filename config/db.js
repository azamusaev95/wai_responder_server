// config/db.js
import { Sequelize } from "sequelize";
import dotenv from "dotenv";

dotenv.config(); // загружаем .env (если ещё нигде не загружал)

const { DATABASE_URL } = process.env;

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is not set in .env");
}

const sequelize = new Sequelize(DATABASE_URL, {
  dialect: "postgres",
  dialectOptions: {
    ssl: {
      require: true,
      rejectUnauthorized: false,
    },
  },
  logging: false,
});

export default sequelize;
