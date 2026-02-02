FROM denoland/deno:2.6.6

WORKDIR /app

# Cache dependencies first for faster rebuilds
COPY deno.json deno.lock ./
COPY core ./core
COPY server ./server
RUN deno cache --lock=deno.lock ./server/main.ts

EXPOSE 8080

CMD ["run", "--allow-net", "--allow-read", "--allow-write", "--allow-env", "./server/main.ts"]
