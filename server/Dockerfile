FROM node:24-bookworm-slim

ENV MONGOMS_DISABLE_POSTINSTALL=1

WORKDIR /app

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci

COPY --chown=node:node . .

USER node

EXPOSE 5000

CMD ["npm", "start"]
