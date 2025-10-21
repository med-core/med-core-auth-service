import express from "express";
import cors from "cors";
import { connectDB } from "./config/database.js";
import authRoutes from "./router/authRoutes.js";


const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
    res.send("Auth microservice funcionando correctamente");
});

app.get("/health", (req, res) => {
    res.status(200).json({ status: "ok" });
});


app.use("/api/v1/auth", authRoutes);

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
    console.log(`Auth microservice corriendo en puerto ${PORT}`);
    await connectDB();
});