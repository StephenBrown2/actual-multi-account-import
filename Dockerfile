FROM node:22-alpine AS base

WORKDIR /app

COPY package.json ./
RUN npm install --no-package-lock

COPY . .

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["npm", "run", "server"]
