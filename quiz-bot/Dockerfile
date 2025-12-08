FROM node:20-alpine

WORKDIR /app

# ✅ เพิ่มบรรทัดนี้: ติดตั้ง OpenSSL ที่ Prisma จำเป็นต้องใช้
RUN apk add --no-cache openssl

# 1. ลง Package
COPY package*.json ./
RUN npm install

# 2. ก๊อปปี้โค้ด
COPY . .

# 3. สั่งรัน (ใช้ Path เต็ม)
CMD ["sh", "-c", "npx prisma generate --schema=/app/prisma/schema.prisma && node index.js"]