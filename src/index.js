import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import authRoutes from "./router/authRoutes.js";

dotenv.config();
const app = express();

app.use(cors());
app.use(express.json());

app.use("/auth", authRoutes);

app.get("/", (req, res) => {
  res.send("Auth Service funcionando");
});

app.listen(process.env.PORT, () =>
  console.log(`Auth Service corriendo en puerto ${process.env.PORT}`)
);
