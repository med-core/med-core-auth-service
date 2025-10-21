import { getPrismaClient } from "../config/database.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import axios from "axios";
import { generateVerificationCode, sendVerificationEmail } from "../config/emailConfig.js";

const prisma = getPrismaClient();

// ================= SIGNUP =================
export const signup = async (req, res) => {
  try {
    let { email, password, fullname, role } = req.body;

    if (!email || !password || !fullname) {
      return res.status(400).json({ message: "Faltan datos obligatorios" });
    }

    email = email.toLowerCase().trim();
    const existingAuth = await prisma.auth.findUnique({ where: { email } });
    if (existingAuth) {
      return res.status(400).json({ message: "El usuario ya está registrado" });
    }

    // Hash contraseña
    const passwordHash = await bcrypt.hash(password, 10);
    const verificationCode = generateVerificationCode();
    const verificationExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 min

    // Crear registro en Auth
    const auth = await prisma.auth.create({
      data: {
        email,
        passwordHash,
        isEmailVerified: false,
        verificationCode,
        verificationExpires,
      },
    });

    // Crear el usuario en el User Service
    const userResponse = await axios.post(
      "http://med-core-user-service:3002/api/v1/users/create",
      {
        email,
        fullname,
        role: role || "PACIENTE",
        status: "PENDING",
      }
    );

    // Vincular el userId
    const updatedAuth = await prisma.auth.update({
      where: { id: auth.id },
      data: { userId: userResponse.data.user.id },
    });

    // Enviar correo de verificación
    await sendVerificationEmail(email, fullname, verificationCode);

    return res.status(201).json({
      message: "Usuario registrado correctamente. Verifica tu correo electrónico.",
      auth: updatedAuth,
      user: userResponse.data.user,
    });
  } catch (error) {
    console.error("Error en signup:", error);
    return res.status(500).json({ message: "Error interno del servidor", error: error.message });
  }
};

// ================= VERIFY EMAIL =================
export const verifyEmail = async (req, res) => {
  try {
    let { email, verificationCode } = req.body;
    if (!email || !verificationCode) {
      return res.status(400).json({ message: "Email y código de verificación son requeridos" });
    }

    email = email.toLowerCase().trim();
    const auth = await prisma.auth.findUnique({ where: { email } });
    if (!auth) return res.status(404).json({ message: "Usuario no encontrado" });
    if (auth.isEmailVerified) return res.status(400).json({ message: "El email ya fue verificado" });

    if (
      auth.verificationCode !== verificationCode ||
      new Date() > auth.verificationExpires
    ) {
      return res.status(400).json({ message: "Código de verificación incorrecto o expirado" });
    }

    // Actualizar en Auth
    const updatedAuth = await prisma.auth.update({
      where: { email },
      data: {
        isEmailVerified: true,
        verificationCode: null,
        verificationExpires: null,
      },
    });

    // También actualizar el estado del usuario en el User Service
    await axios.patch(
      `http://med-core-user-service:3002/api/v1/users/status/${updatedAuth.userId}`,
      { status: "ACTIVE" }
    );

    return res.status(200).json({
      message: "Email verificado correctamente. Tu cuenta ahora está activa.",
      userId: updatedAuth.userId,
    });
  } catch (error) {
    console.error("Error en verifyEmail:", error);
    return res.status(500).json({ message: "Error interno del servidor", error: error.message });
  }
};

// ================= RESEND VERIFICATION CODE =================
export const resendVerificationCode = async (req, res) => {
  try {
    let { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email es requerido" });

    email = email.toLowerCase().trim();
    const auth = await prisma.auth.findUnique({ where: { email } });
    if (!auth) return res.status(404).json({ message: "Usuario no encontrado" });
    if (auth.isEmailVerified) {
      return res.status(400).json({ message: "La cuenta ya está verificada" });
    }

    const verificationCode = generateVerificationCode();
    const verificationExpires = new Date(Date.now() + 15 * 60 * 1000);

    await prisma.auth.update({
      where: { email },
      data: { verificationCode, verificationExpires },
    });

    await sendVerificationEmail(email, "Usuario", verificationCode);

    return res.status(200).json({ message: "Nuevo código de verificación enviado a tu email" });
  } catch (error) {
    console.error("Error en resendVerificationCode:", error);
    return res.status(500).json({ message: "Error interno del servidor", error: error.message });
  }
};

// ================= LOGIN =================
export const login = async (req, res) => {
  try {
    let { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: "Email y contraseña son requeridos" });
    }

    email = email.toLowerCase().trim();
    const auth = await prisma.auth.findUnique({ where: { email } });
    if (!auth) return res.status(404).json({ message: "Usuario no encontrado" });
    if (!auth.isEmailVerified) {
      return res.status(403).json({ message: "La cuenta no está verificada" });
    }

    const isMatch = await bcrypt.compare(password, auth.passwordHash);
    if (!isMatch) return res.status(401).json({ message: "Contraseña incorrecta" });

    if (!process.env.JWT_SECRET) {
      throw new Error("JWT_SECRET no está definido");
    }

    const token = jwt.sign(
      { id: auth.userId, email: auth.email },
      process.env.JWT_SECRET,
      { expiresIn: "24h" }
    );

    return res.status(200).json({
      message: "Inicio de sesión exitoso",
      token,
      user: {
        id: user.id,
        email: user.email,
        fullname: user.fullname,
        status: user.status,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Error en login:", error);
    return res.status(500).json({ message: "Error interno del servidor", error: error.message });
  }
};

// ================= VERIFY TOKEN =================
export const verifyToken = (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Token requerido" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return res.json({ valid: true, user: decoded });
  } catch (err) {
    return res.status(401).json({ valid: false, error: "Token inválido" });
  }
};
