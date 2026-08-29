FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=7460

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server ./server
COPY build/web-desktop ./build/web-desktop

USER node
EXPOSE 7460
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:7460/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server/index.mjs"]
