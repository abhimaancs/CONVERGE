FROM python:3.12-slim

# No network access needed inside the sandbox — the repo is mounted in,
# tests run against it, results come out. Nothing installed at runtime
# beyond what's baked in here, which limits what an LLM-written "fix"
# could actually do even if it tried something malicious.
RUN pip install --no-cache-dir pytest

WORKDIR /workspace

# Default command is overridden by docker-sandbox.js per run,
# this is just a safe fallback.
CMD ["pytest", "-q"]
