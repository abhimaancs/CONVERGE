FROM node:24-bookworm-slim

# No network access needed inside the sandbox — the repo is mounted in,
# tests run against it, results come out. Nothing installed at runtime
# beyond what's baked in here, which limits what an LLM-written "fix"
# could actually do even if it tried something malicious.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pytest \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

# Default command is overridden by docker-sandbox.js per run,
# this is just a safe fallback.
CMD ["pytest", "-q"]
