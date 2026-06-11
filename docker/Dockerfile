# syntax=docker/dockerfile:1
#
# Purpose-built CI image: the docref binary plus git on a tiny Alpine base, so
# a CI job mounts its repo and runs `docref check` with nothing to install,
# build, or wire up. The release workflow builds it from the prebuilt musl
# binaries; multi-arch is selected with TARGETARCH (amd64 / arm64).
#
#   docker run --rm -v "$PWD:/repo" ghcr.io/manchtools/open-docref check
#
FROM alpine:3.20

# git: docref shells out to it for `affected`, `diff`, cross-repo `update`, and
# the gitignore-aware anchor scan. libstdc++/libgcc: the musl binary's runtime.
RUN apk add --no-cache git libstdc++ libgcc

ARG TARGETARCH
COPY docref-linux-${TARGETARCH} /usr/local/bin/docref

WORKDIR /repo
ENTRYPOINT ["docref"]
CMD ["check"]
