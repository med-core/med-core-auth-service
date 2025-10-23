import jwt from "jsonwebtoken";
import { getPrismaClient } from "../config/database.js";
const prisma = getPrismaClient();
// Verifica el token JWT y carga el usuario
export async function verifyToken(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1]; // "Bearer <token>"
  console.log(req.headers.authorization);
  if (!token) {
    return res.status(401).json({ message: "Token no proporcionado." });
  }

  try {
    // Decodifica el token (clave secreta del .env)
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Busca el usuario en la base de datos
    const user = await prisma.users.findUnique({ where: { id: decoded.id } });
    if (!user) {
      return res.status(401).json({ message: "Usuario no encontrado o inválido." });
    }

    // Agrega el usuario al request
    req.user = user;

    next();
  } catch (error) {
    console.error("Error al verificar token:", error);
    res.status(401).json({ message: "Token inválido o expirado." });
  }
}
