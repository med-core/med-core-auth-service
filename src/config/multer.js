import multer from "multer";
import fs from "fs";
import path from "path";

/* -------------------------------------------
   Crear directorio si no existe
--------------------------------------------*/
const ensureDirectoryExists = (directory) => {
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }
};

/* -------------------------------------------
   Configuración: Subida de CSV de usuarios
--------------------------------------------*/
const csvStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join("uploads", "csv");
    ensureDirectoryExists(uploadPath);
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    cb(null, `users_${timestamp}.csv`);
  },
});

const csvFileFilter = (req, file, cb) => {
  if (file.mimetype === "text/csv" || file.originalname.endsWith(".csv")) {
    cb(null, true);
  } else {
    cb(new Error("Solo se permiten archivos CSV"));
  }
};

const uploadCSV = multer({
  storage: csvStorage,
  fileFilter: csvFileFilter,
});

export const uploadUserCSV = uploadCSV.single("file");
