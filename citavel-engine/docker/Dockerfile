FROM node:20-alpine
RUN apk add --no-cache chromium
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --omit=dev --no-audit --no-fund
COPY core ./core
COPY server.mjs ./
ENV HOST=0.0.0.0 PORT=8787 CITAVEL_ROOT=/data OLLAMA_URL=http://host.docker.internal:11434 CHROMIUM_PATH=/usr/bin/chromium-browser
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:8787/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node","server.mjs"]
