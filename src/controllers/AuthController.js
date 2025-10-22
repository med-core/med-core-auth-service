import { getPrismaClient } from "../config/database.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import axios from "axios";
import { generateVerificationCode, sendVerificationEmail } from "../config/emailConfig.js";

const prisma = getPrismaClient();

// ================= SIGNUP =================
export const signup = async (req, res) => {
  try {
    let { email,  current_password, fullname, role } = req.body;

    // Validaciones básicas
    if (!email || ! current_password || !fullname) {
      return res.status(400).json({ message: "Faltan datos obligatorios" });
    }

    email = email.toLowerCase().trim();

    const emailRegex = /^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: "Formato de correo electrónico incorrecto" });
    }

    if ( current_password.length < 6) {
      return res.status(400).json({ message: "La contraseña debe tener al menos 6 caracteres" });
    }

    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{6,}$/;
    if (!passwordRegex.test( current_password)) {
      return res.status(400).json({ message: "La contraseña debe contener al menos un número" });
    }

    // Revisar si ya existe en Auth
    const existingAuth = await prisma.auth.findUnique({ where: { email } });
    if (existingAuth) {
      return res.status(400).json({ message: "El usuario ya está registrado" });
    }

    // Generar hash de contraseña y código de verificación
    const passwordHash = await bcrypt.hash( current_password, 10);
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

    // Enviar correo de verificación primero
    const emailResult = await sendVerificationEmail(email, fullname, verificationCode);
    if (!emailResult.success) {
      await prisma.auth.delete({ where: { id: auth.id } });
      return res.status(500).json({
        message: "Error enviando email de verificación. Intenta nuevamente.",
        error: emailResult.error,
      });
    }

    // Crear el usuario en el User Service
    let userResponse;
    try {
      userResponse = await axios.post(
        "http://med-core-user-service:3000/api/v1/users/create",
        {
          email,
          fullname,
          role: role || "PACIENTE",
          status: "PENDING",
          current_password: passwordHash
        }
      );
    } catch (err) {
      // Si falla User Service, eliminamos el Auth creado para mantener consistencia
      await prisma.auth.delete({ where: { id: auth.id } });
      return res.status(500).json({
        message: "Error creando usuario en User Service",
        error: err.message,
      });
    }

    // Vincular userId en Auth
    await prisma.auth.update({
      where: { id: auth.id },
      data: { userId: userResponse.data.user.id },
    });

    return res.status(201).json({
      message: "Usuario registrado correctamente. Revisa tu email para verificar la cuenta.",
      auth,
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
    let { email,  current_password } = req.body;
    console.log("Body recibido:", req.body);
    if (!email || ! current_password) {
      return res.status(400).json({ message: "Email y contraseña son requeridos" });
    }

    email = email.toLowerCase().trim();
    const auth = await prisma.auth.findUnique({ where: { email } });
    if (!auth) return res.status(404).json({ message: "Usuario no encontrado" });

    if (!auth.isEmailVerified) {
      return res.status(403).json({ message: "La cuenta no está verificada" });
    }

    const isMatch = await bcrypt.compare( current_password, auth.passwordHash);
    if (!isMatch) return res.status(401).json({ message: "Contraseña incorrecta" });

    if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET no está definido");

    const token = jwt.sign({ id: auth.userId, email: auth.email }, process.env.JWT_SECRET, {
      expiresIn: "24h",
    });

    // Obtener datos del usuario desde User Service
    const userRes = await axios.get(`http://localhost:3000/api/users/${auth.userId}`);
    const user = userRes.data;

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
