# CITÁVEL Manager — production image (Next.js + Prisma + Chromium for the PDF Report Engine).
FROM node:20-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-inter fonts-open-sans openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV CHROMIUM_PATH=/usr/bin/chromium NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npx prisma generate && npx next build --webpack

FROM base AS run
ENV NODE_ENV=production PORT=3002
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/lib/report/assets ./lib/report/assets
COPY --from=build /app/next.config.ts ./next.config.ts
RUN useradd -r -u 10001 citavel && mkdir -p /app/.runtime && chown -R citavel /app/.runtime
USER citavel
EXPOSE 3002
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3002/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "next", "start", "--hostname", "0.0.0.0", "--port", "3002"]
