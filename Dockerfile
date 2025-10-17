FROM node:20-alpine
WORKDIR /app
EXPOSE 3001
CMD ["node", "src/index.js"]
# Copiamos schema.prisma y package.json
COPY package*.json prisma/ ./

# Instalamos dependencias
RUN npm install --production

# Generamos Prisma Client dentro del contenedor
RUN npx prisma generate

# Copiamos el resto del código
COPY . .