# syntax=docker/dockerfile:1.7

FROM node:22.12-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
ARG VITE_API_BASE_URL=/api
ARG VITE_SHOW_DEMO_ACCOUNTS=false
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_SHOW_DEMO_ACCOUNTS=${VITE_SHOW_DEMO_ACCOUNTS}
COPY . .
RUN npm run prisma:generate && npm run build

# Run this target once per deployment as a release/migration job. It includes
# development tooling intentionally; the long-running API target does not.
FROM dependencies AS migration
COPY --chown=node:node server ./server
RUN mkdir -p /app/server/prisma/data /app/server/storage/payment-proofs \
    && chown -R node:node /app/server/prisma/data /app/server/storage/payment-proofs
CMD ["npm", "run", "migrate:deploy"]

FROM node:22.12-bookworm-slim AS api
WORKDIR /app
ENV NODE_ENV=production PORT=3001
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --chown=node:node server ./server
RUN mkdir -p /app/server/prisma/data /app/server/storage/payment-proofs \
    && chown -R node:node /app/server/prisma/data /app/server/storage/payment-proofs
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["npm", "start"]

FROM nginx:1.28-alpine AS web
COPY --from=build /app/dist /usr/share/nginx/html
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
