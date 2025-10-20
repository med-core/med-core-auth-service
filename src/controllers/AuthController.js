import { prisma } from "../config/database.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { generateVerificationCode, sendVerificationEmail } from "../config/emailConfig.js";


// ================= SIGNUP =================
export const signup = async (req, res) => {
  try {
    let { email, current_password, fullname } = req.body;

    if (!email || !current_password || !fullname) {
      return res.status(400).json({ message: "Faltan datos obligatorios" });
    }

    email = email.toLowerCase().trim();
    const emailRegex = /^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: "Formato de correo electrónico es incorrecto" });
    }

    if (current_password.length < 6) {
      return res.status(400).json({ message: "La contraseña debe tener al menos 6 caracteres" });
    }

    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{6,}$/;
    if (!passwordRegex.test(current_password)) {
      return res.status(400).json({ message: "La contraseña debe tener al menos un número" });
    }

    const userExists = await prisma.users.findUnique({ where: { email } });
    if (userExists) {
      return res.status(400).json({ message: "El usuario ya está registrado" });
    }

    const verificationCode = generateVerificationCode();
    const verificationExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutos

    const createUser = await prisma.users.create({
      data: {
        email,
        current_password: await bcrypt.hash(current_password, 10),
        fullname,
        status: "PENDING",
        verificationCode,
        verificationExpires,
      },
    });

    const emailResult = await sendVerificationEmail(email, fullname, verificationCode);
    console.log("Resultado envío email:", emailResult);

    if (!emailResult.success) {
      await prisma.users.delete({ where: { id: createUser.id } });
      return res.status(500).json({
        message: "Error enviando el email de verificación. Intenta nuevamente.",
        error: emailResult.error,
      });
    }

    return res.status(201).json({
      message: "Usuario registrado correctamente. Revisa tu email para verificar la cuenta.",
      user: createUser,
    });
  } catch (error) {
    console.error("Error en signup:", error);
    return res.status(500).json({ message: "Error interno del servidor" });
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
    const user = await prisma.users.findUnique({ where: { email } });
    if (!user) return res.status(404).json({ message: "Usuario no encontrado" });
    if (user.status === "ACTIVE") return res.status(400).json({ message: "La cuenta ya está verificada" });

    if (user.verificationCode !== verificationCode || new Date() > user.verificationExpires) {
      return res.status(400).json({ message: "Código de verificación incorrecto o expirado" });
    }

    const updateUser = await prisma.users.update({
      where: { id: user.id },
      data: { status: "ACTIVE", verificationCode: null, verificationExpires: null },
    });

    return res.status(200).json({
      message: "Email verificado correctamente. Tu cuenta ahora está activa.",
      user: {
        id: updateUser.id,
        email: updateUser.email,
        fullname: updateUser.fullname,
        status: updateUser.status,
      },
    });
  } catch (error) {
    console.error("Error en verifyEmail:", error);
    return res.status(500).json({ message: "Error interno del servidor" });
  }
};

// ================= RESEND VERIFICATION CODE =================
export const resendVerificationCode = async (req, res) => {
  try {
    let { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email es requerido" });

    email = email.toLowerCase().trim();
    const user = await prisma.users.findUnique({ where: { email } });
    if (!user) return res.status(404).json({ message: "Usuario no encontrado" });
    if (user.status === "ACTIVE") return res.status(400).json({ message: "La cuenta ya está verificada" });

    const verificationCode = generateVerificationCode();
    const verificationExpires = new Date(Date.now() + 15 * 60 * 1000);

    await prisma.users.update({
      where: { id: user.id },
      data: { verificationCode, verificationExpires },
    });

    const emailResult = await sendVerificationEmail(email, user.fullname, verificationCode);
    if (!emailResult.success) {
      return res.status(500).json({ message: "Error enviando email de verificación" });
    }

    return res.status(200).json({ message: "Nuevo código de verificación enviado a tu email" });
  } catch (error) {
    console.error("Error en resendVerificationCode:", error);
    return res.status(500).json({ message: "Error interno del servidor" });
  }
};

// ================= LOGIN =================
export const login = async (req, res) => {
  try {
    let { email, current_password } = req.body;
    if (!email || !current_password) {
      return res.status(400).json({ message: "Email y contraseña son requeridos" });
    }

    email = email.toLowerCase().trim();
    const user = await prisma.users.findUnique({ where: { email } });
    if (!user) return res.status(404).json({ message: "Usuario no encontrado" });
    if (user.status !== "ACTIVE") return res.status(403).json({ message: "La cuenta no está verificada o activa" });

    const isMatch = await bcrypt.compare(current_password, user.current_password);
    if (!isMatch) return res.status(401).json({ message: "Contraseña incorrecta" });

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET || "secret_key",
      { expiresIn: "1h" }
    );

    return res.status(200).json({
      message: "Inicio de sesión exitoso",
      token,
      user: {
        id: user.id,
        email: user.email,
        fullname: user.fullname,
        status: user.status,
      },
    });
  } catch (error) {
    console.error("Error en login:", error);
    return res.status(500).json({ message: "Error interno del servidor" });
  }
};