FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY relay.js ./

# Hugging Face Spaces は 7860 を使います。Render 等は PORT を自動で渡します。
ENV PORT=7860
EXPOSE 7860

CMD ["node", "relay.js"]
