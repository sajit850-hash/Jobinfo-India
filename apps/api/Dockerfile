FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/database/package.json packages/database/package.json
RUN npm ci
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run db:generate
RUN npm run build --workspace @jobinfo/database
RUN npm run build --workspace @jobinfo/api
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN mkdir -p /data/private-uploads && chown -R node:node /data
ENV UPLOAD_DIR=/data/private-uploads
ENV FILE_STORAGE=local
USER node
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/packages/database ./packages/database
COPY --from=build /app/package.json ./package.json
EXPOSE 4000
CMD ["npm","run","start","--workspace","@jobinfo/api"]
