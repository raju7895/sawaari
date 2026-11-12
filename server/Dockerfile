# ── API image ────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

# dependencies first (better layer caching)
COPY package*.json ./
RUN npm ci --omit=dev

# source
COPY src ./src
COPY .env.example ./.env.example

RUN mkdir -p uploads && \
    addgroup -S sawaari && adduser -S sawaari -G sawaari && \
    chown -R sawaari:sawaari /app
USER sawaari

ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
