FROM denoland/deno:2.6.6

WORKDIR /app

# Cache dependencies first for faster rebuilds
COPY deno.json deno.lock ./
COPY app-version.ts ./
COPY core ./core
COPY server ./server
RUN deno cache --lock=deno.lock ./server/main.ts

# F-SERVER-05: drop root before the container runs. The `deno` user is
# provisioned by the upstream `denoland/deno` base image. `chown` ensures
# the unprivileged user can read the cached modules under /app and write
# an sqlite DB file if one is mounted into the working directory.
RUN chown -R deno:deno /app
USER deno

EXPOSE 8080

CMD ["run", "--allow-net", "--allow-read", "--allow-write", "--allow-env", "./server/main.ts"]
