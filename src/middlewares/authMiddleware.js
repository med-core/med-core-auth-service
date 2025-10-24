import jwt from "jsonwebtoken";
import { getPrismaClient } from "../config/database.js";
import axios from "axios";

const prisma = getPrismaClient();

export const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ message: "Token requerido" });

    const token = authHeader.split(" ")[1];
    if (!token) return res.status(401).json({ message: "Token requerido" });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Buscar en tabla auth
    const auth = await prisma.auth.findUnique({ where: { id: decoded.id } });
    if (!auth) return res.status(401).json({ message: "Usuario no encontrado en Auth" });

    // Obtener datos de usuario desde User Service
    const userRes = await axios.get(
      `http://med-core-user-service:3000/api/v1/users/${auth.userId}`
    );
    req.user = userRes.data;

    next();
  } catch (error) {
    console.error("Error al verificar token:", error.message);
    return res.status(401).json({ message: "Token inválido o expirado" });
  }
};
