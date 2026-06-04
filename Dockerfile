FROM node:20-alpine
RUN apk add --no-cache python3 make g++ gcc libc-dev
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY . .
EXPOSE 8080
CMD ["node", "server.js"]
