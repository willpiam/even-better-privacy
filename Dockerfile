# F-DOCKER-01: pin both the human-readable Deno tag and immutable manifest-list
# digest. Refresh with:
#   docker buildx imagetools inspect denoland/deno:<version>
FROM denoland/deno:2.6.6@sha256:08941c4fcc2f0448d34ca2452edeb5bca009bed29313079cfad0e5e2fa37710f

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
