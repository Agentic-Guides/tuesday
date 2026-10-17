# Tuesday — the whole demo, served by the project's own zero-dependency Node server.
#
# Render's Node runtime failed with "Exited with status 1" during the build
# (25.2s, first deploy of 249ff84). Rather than guess at the npm build step, pin
# the runtime in a container: this image has no build step that can fail, and it
# matches the Space image the demo was verified against.
#
# The demo needs no API keys: every integration degrades to a deterministic
# engine, a mock PayPal client and a curated catalogue.
FROM node:22-alpine

WORKDIR /app

# Copy the repo as the project ships it. There are no dependencies to install --
# package.json declares none, and demo/server.mjs only imports node: builtins.
COPY . .

# Render routes external traffic to $PORT; demo/server.mjs reads it.
ENV PORT=7860
EXPOSE 7860

# A free instance spins down after 15 minutes idle, so a judge's first request
# can wait ~50s. This health check is what wakes it without a human.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||7860)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "demo/server.mjs"]
