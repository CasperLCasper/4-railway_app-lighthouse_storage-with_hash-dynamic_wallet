# 1. Izmantojam oficiālo Node.js vidi
FROM node:20

# 2. Izveidojam mapi konteinerā
WORKDIR /app

# 3. Nokopējam pakotņu failus
COPY package*.json ./

# 4. Uzinstalējam visas tavas pakotnes (Express, Lighthouse SDK utt.)
RUN npm install

# 5. Nokopējam absolūti visus failus un mapes (arī public un functions)
COPY . .

# 6. Atveram portu (Tavs Express serveris parasti klausās uz 3000 vai process.env.PORT)
EXPOSE 3000

# 7. PALAIŽAM tavu īsto galveno failu!
CMD ["node", "server.js"]
