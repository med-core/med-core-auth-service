import { getPrismaClient } from "../config/database.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import axios from "axios";
import { generateVerificationCode, sendVerificationEmail } from "../config/emailConfig.js";
import { AppError, ErrorCodes } from "../utils/errorHandler.js";

const prisma = getPrismaClient();

// ================= SIGNUP =================
export const signup = async (req, res) => {
  try {
    let { email, current_password, fullname, role } = req.body;

    // Validaciones básicas
    if (!email || !current_password || !fullname) {
      return res.status(400).json({ message: "Faltan datos obligatorios" });
    }

    email = email.toLowerCase().trim();

    const emailRegex = /^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: "Formato de correo electrónico incorrecto" });
    }

    if (current_password.length < 6) {
      return res.status(400).json({ message: "La contraseña debe tener al menos 6 caracteres" });
    }

    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{6,}$/;
    if (!passwordRegex.test(current_password)) {
      return res.status(400).json({ message: "La contraseña debe contener al menos un número" });
    }

    // Verificar si ya existe en Auth
    const existingAuth = await prisma.auth.findUnique({ where: { email } });
    if (existingAuth) {
      return res.status(400).json({ message: "El usuario ya está registrado" });
    }

    // Crear el usuario primero en el User Service
    let userResponse;
    try {
      userResponse = await axios.post(
        "http://med-core-user-service:3000/api/v1/users/create",
        {
          email,
          fullname,
          role: role || "PACIENTE",
          status: "PENDING",
          current_password
        }
      );
    } catch (err) {
      console.error("Error creando usuario en User Service:", err.message);
      return res.status(500).json({
        message: "Error creando usuario en User Service",
        error: err.message,
      });
    }

    const user = userResponse.data.user;
    if (!user || !user.id) {
      return res.status(500).json({ message: "Error: el User Service no devolvió un ID válido" });
    }

    // Generar hash y código de verificación
    const passwordHash = await bcrypt.hash(current_password, 10);
    const verificationCode = generateVerificationCode();
    const verificationExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 min

    // Crear registro en Auth
    const auth = await prisma.auth.create({
      data: {
        userId: user.id,
        email,
        passwordHash,
        isEmailVerified: false,
        verificationCode,
        verificationExpires,
      },
    });

    // Enviar correo de verificación
    const emailResult = await sendVerificationEmail(email, fullname, verificationCode);
    if (!emailResult.success) {
      // rollback: borrar el usuario creado en User Service
      await axios.delete(`http://med-core-user-service:3000/api/v1/users/${user.id}`);
      await prisma.auth.delete({ where: { id: auth.id } });
      return res.status(500).json({
        message: "Error enviando email de verificación. Intenta nuevamente.",
        error: emailResult.error,
      });
    }

    // Responder
    return res.status(201).json({
      message: "Usuario registrado correctamente. Revisa tu email para verificar la cuenta.",
      auth,
      user,
    });

  } catch (error) {
    console.error("Error en signup:", error);
    return res.status(500).json({ message: "Error interno del servidor", error: error.message });
  }
};

//============BulkSignUp=========
export const bulkSignUp = async (req, res) => {
  try {
    const { userId, email, password, verified = false } = req.body;

    if (!userId || !email || !password) {
      return res.status(400).json({ message: "Faltan userId, email o password" });
    }

    const existing = await prisma.auth.findFirst({
      where: { OR: [{ email }, { userId }] },
    });

    if (existing) {
      return res.status(200).json({ message: "Usuario ya existente en Auth", userId });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const newAuth = await prisma.auth.create({
      data: {
        userId,
        email: email.toLowerCase(),
        passwordHash,
        isEmailVerified: verified,
        verificationCode: verified ? null : Math.floor(100000 + Math.random() * 900000).toString(),
        verificationExpires: verified ? null : new Date(Date.now() + 15 * 60 * 1000),
      },
    });

    console.log("Auth creado:", newAuth.email);

    return res.status(201).json({ message: "Auth creado correctamente", userId });
  } catch (error) {
    console.error("Error en bulkSignUp:", error);
    return res.status(500).json({ message: "Error interno en Auth Service" });
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
      `http://med-core-user-service:3000/api/v1/users/status/${updatedAuth.userId}`,
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
    let { email, current_password } = req.body;
    console.log("Body recibido:", req.body);

    if (!email || !current_password) {
      return res.status(400).json({ message: "Email y contraseña son requeridos" });
    }

    email = email.toLowerCase().trim();

    // Buscar usuario en la colección Auth
    const auth = await prisma.auth.findUnique({ where: { email } });
    if (!auth) return res.status(404).json({ message: "Usuario no encontrado" });

    // Verificar si el correo fue confirmado
    if (!auth.isEmailVerified) {
      return res.status(403).json({ message: "La cuenta no está verificada" });
    }

    // Validar contraseña
    const isMatch = await bcrypt.compare(current_password, auth.passwordHash);
    if (!isMatch) return res.status(401).json({ message: "Contraseña incorrecta" });

    // Obtener los datos reales del usuario desde el user-service
    const userRes = await axios.get(`http://med-core-user-service:3000/api/v1/users/${auth.userId}`);
    const user = userRes.data;

    // Verificar si el usuario está activo antes de generar el token
    if (user.status !== "ACTIVE") {
      return res.status(403).json({ message: "Cuenta inactiva. Contacte al administrador." });
    }

    // Validar que exista JWT_SECRET
    if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET no está definido");

    // Generar token con los datos correctos
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
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
export const verify = async (req, res) => {
  try {
    const user = req.user;
    res.status(200).json({
      message: "Token válido",
      user: {
        id: user.id,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    throw new AppError("Error al verificar el token", 500, {
      code: ErrorCodes.SERVICE_UNAVAILABLE
    });
  }
};