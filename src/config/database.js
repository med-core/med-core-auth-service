import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function connectDB() {
  try {
    await prisma.$connect();
    console.log("Conexión a MongoDB establecida con Prisma.");
  } catch (error) {
    console.error("Error conectando a MongoDB:", error);
    process.exit(1);
  }
}

export { prisma, connectDB };
