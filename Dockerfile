FROM node:20-slim

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install --only=production

COPY . .
# Remove creds.json from container for security
RUN rm -f creds.json

ENV PORT=8080
EXPOSE 8080

CMD ["npm", "start"]
