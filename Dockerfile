FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --chown=node:node index.html styles.css app.js server.mjs ./
RUN mkdir -p /data/photos && chown -R node:node /app /data
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
