FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node app.js logger.js metrics.js runtime-config.js ./
COPY --chown=node:node views ./views
COPY --chown=node:node static ./static

USER node

EXPOSE 3000

CMD ["node", "app.js"]
