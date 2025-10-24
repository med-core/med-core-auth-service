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

    // Revisar si ya existe en Auth
    const existingAuth = await prisma.auth.findUnique({ where: { email } });
    if (existingAuth) {
      return res.status(400).json({ message: "El usuario ya está registrado" });
    }

    // Generar hash de contraseña y código de verificación
    const passwordHash = await bcrypt.hash(current_password, 10);
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

//===========BULKSIGN-UP============================
export const bulkSignup = async (req, res) => {
  console.log("📦 BODY RECIBIDO EN BULKSIGNUP:", req.body);
  try {
    const users = req.body.users; // [{ email, current_password, fullname, role }, ...]

    if (!Array.isArray(users) || users.length === 0) {
      return res.status(400).json({ message: "Debe enviar un array de usuarios" });
    }

    const results = {
      inserted: 0,
      duplicates: 0,
      errors: 0,
      details: [],
    };

    for (const u of users) {
      try {
        let { email, current_password, fullname, role } = u;
        console.log("Procesando usuario:", email);

        if (!email || !current_password || !fullname) {
          console.log("Faltan datos obligatorios para:", email);
          results.errors++;
          results.details.push({ email, error: "Faltan datos obligatorios" });
          continue;
        }

        email = email.toLowerCase().trim();
        fullname = fullname.trim();
        role = role ? role.toUpperCase() : "PACIENTE";

        // Validar formato email
        const emailRegex = /^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$/;
        if (!emailRegex.test(email)) {
          console.log("Formato de correo incorrecto:", email);
          results.errors++;
          results.details.push({ email, error: "Formato de correo incorrecto" });
          continue;
        }

        if (current_password.length < 6) {
          console.log("Contraseña muy corta para:", email);
          results.errors++;
          results.details.push({ email, error: "La contraseña debe tener al menos 6 caracteres" });
          continue;
        }

        const existingAuth = await prisma.auth.findUnique({ where: { email } });
        if (existingAuth) {
          console.log("Usuario ya existe en Auth:", email);
          results.duplicates++;
          results.details.push({ email, error: "Usuario ya existe" });
          continue;
        }

        const passwordHash = await bcrypt.hash(current_password, 10);

        console.log("Creando registro en Auth para:", email);
        const auth = await prisma.auth.create({
          data: {
            email,
            passwordHash,
            isEmailVerified: true,
          },
        });

        console.log("Creando usuario en User Service para:", email);
        let userResponse;
        try {
          userResponse = await axios.post(
            "http://med-core-user-service:3000/api/v1/users/create",
            {
              email,
              fullname,
              role,
              status: "PENDING",
              current_password: passwordHash,
            }
          );
          console.log("Respuesta User Service para", email, ":", userResponse.data);
        } catch (err) {
          console.error("Error creando usuario en User Service para", email, err.message);
          await prisma.auth.delete({ where: { id: auth.id } });
          results.errors++;
          results.details.push({ email, error: "Error creando usuario en User Service: " + err.message });
          continue;
        }

        console.log("Actualizando userId en Auth para:", email);
        await prisma.auth.update({
          where: { id: auth.id },
          data: { userId: userResponse.data.user.id },
        });


        results.inserted++;
        results.details.push({ email, status: "Creado correctamente" });

      } catch (err) {
        console.error("Error interno procesando usuario", u.email, err.message);
        results.errors++;
        results.details.push({ email: u.email, error: err.message });
      }
    }

    console.log("Bulk signup finalizado:", results);

    return res.json({
      message: "Carga masiva completada",
      total: users.length,
      ...results,
    });

  } catch (error) {
    console.error("Error en bulkSignup:", error);
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