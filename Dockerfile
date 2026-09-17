# syntax=docker/dockerfile:1

# Node 22 is not optional: server/store.ts and server/auth.ts open every
# database through the built-in node:sqlite, and package.json pins >=22.13.0.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Type-checks the frontend, bundles it to dist/, and emits the API to dist-server/.
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server

# The 127.0.0.1 default is right for a laptop and accepts nothing through a
# container boundary. The platform's proxy is what faces the internet here.
ENV HOST=0.0.0.0
ENV PORT=3001
# Both belong on the mounted volume. The databases hold Telegram session
# strings, which must survive a redeploy, and a 2 GB upload staged on the
# container's ephemeral layer would fill it.
ENV DATA_DIR=/data
ENV UPLOAD_DIR=/data/uploads

# Runs as root so the process can write to a freshly mounted volume, which
# arrives owned by root. The isolation boundary here is the VM, not the user.
EXPOSE 3001
CMD ["node", "dist-server/index.js"]
