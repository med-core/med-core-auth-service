import express from "express";
import * as authController from "../controllers/AuthController.js";

const router = express.Router();

// Crear rutas para signup y login
// https://med-core.vercel.app/api/v1/auth/login
// http://localhost:3002/api/v1/auth/sign-up
router.post("/sign-up", authController.signup);
router.post("/verify-email", authController.verifyEmail);
router.post("/resend-verification", authController.resendVerificationCode);
router.post("/login", authController.login);

export default router;
