FROM node:20-alpine AS build
WORKDIR /app/dashboard

# Copy only dashboard package files (self-contained, no monorepo deps)
COPY dashboard/package.json dashboard/package-lock.json* ./

RUN npm install

COPY dashboard/ .

RUN npm run build

FROM nginx:1.27-alpine AS production
COPY --from=build /app/dashboard/dist /usr/share/nginx/html
COPY dashboard/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
