# 1. Izmantojam oficiālo Node.js vidi (kur Lighthouse SDK strādās perfekti)
FROM node:20

# 2. Izveidojam mapi serverim
WORKDIR /app

# 3. Nokopējam pakotņu failus
COPY package*.json ./

# 4. Uzinstalējam visas tavas pakotnes (Express, Lighthouse SDK utt.)
RUN npm install

# 5. Nokopējam visu pārējo tavu kodu
COPY . .

# 6. Atveram portu (Back4App izmanto portu 8080 pēc noklusējuma)
EXPOSE 8080

# 7. Komanda, kas palaiž tavu serveri (nomaini index.js, ja tavs galvenais fails saucas citādāk!)
CMD ["node", "index.js"]
