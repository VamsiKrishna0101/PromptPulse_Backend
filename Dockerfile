FROM node:22-slim

WORKDIR /usr/src/app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY prisma ./prisma
COPY src ./src
COPY server.ts ./
COPY prisma.config.ts ./

RUN npx prisma generate

EXPOSE 8080

CMD ["npm", "run", "start"]
