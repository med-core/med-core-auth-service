import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import { connectDB } from "./config/database.js";
import authRoutes from "./router/authRoutes.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Auth microservice funcionando correctamente");
});

app.use("/api/v1/auth", authRoutes);

const PORT = process.env.PORT || 3001;

app.listen(PORT, async () => {
  console.log(`Auth microservice corriendo en puerto ${PORT}`);
  await connectDB();
});
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});