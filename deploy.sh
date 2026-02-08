#!/usr/bin/env bash
set -euo pipefail

# Usage: ./deploy.sh <sprite-name> <github-repo-url> <anthropic-api-key>
# Example: ./deploy.sh moral-agent-alpha https://github.com/user/gurgeh.git sk-ant-...

SPRITE_NAME="${1:-moral-agent-alpha}"
REPO_URL="${2:?Error: GitHub repo URL required as second argument}"
API_KEY="${3:?Error: Anthropic API key required as third argument}"

echo "=== Deploying Autonomous Moral Agent ==="
echo "Sprite: $SPRITE_NAME"
echo "Repo:   $REPO_URL"
echo ""

# 1. Create the Sprite
echo "[1/10] Creating Sprite..."
sprite create "$SPRITE_NAME"

# 2. Set network policy — allow required domains
echo "[2/10] Configuring network policy..."
sprite exec "$SPRITE_NAME" -- bash -c 'cat > /tmp/dns-allowlist.txt << EOF
api.anthropic.com
github.com
raw.githubusercontent.com
objects.githubusercontent.com
en.wikipedia.org
news.ycombinator.com
registry.npmjs.org
EOF'

# 3. Clone repo and install dependencies
echo "[3/10] Cloning repository and installing dependencies..."
sprite exec "$SPRITE_NAME" -- bash -c "
  cd /opt && \
  git clone $REPO_URL agent && \
  cd agent && \
  npm install && \
  npx tsc
"

# 4. Create non-root agent user
echo "[4/10] Creating agent user..."
sprite exec "$SPRITE_NAME" -- bash -c "
  useradd -m -s /bin/bash agent || true
"

# 5. Copy founding document to root and make immutable
echo "[5/10] Installing founding document..."
sprite exec "$SPRITE_NAME" -- bash -c "
  cp /opt/agent/founding-document.md /founding-document.md && \
  chown root:root /founding-document.md && \
  chmod 444 /founding-document.md
"

# 6. Create agent directory structure
echo "[6/10] Creating agent directories..."
sprite exec "$SPRITE_NAME" -- bash -c "
  mkdir -p /self/logs /self/awakenings /self/decisions/pending \
           /projects /income /comms/inbox /comms/outbox /public && \
  chown -R agent:agent /self /projects /income /comms /public
"

# 7. Write .env file
echo "[7/10] Writing configuration..."
sprite exec "$SPRITE_NAME" -- bash -c "
  cat > /opt/agent/.env << EOF
ANTHROPIC_API_KEY=$API_KEY
SPRITE_NAME=$SPRITE_NAME
INITIAL_BUDGET=50.00
AWAKENING_INTERVAL_MINUTES=30
MAX_TOKENS_PER_CYCLE=8192
PORT=8080
EOF
  chown agent:agent /opt/agent/.env
  chmod 600 /opt/agent/.env
"

# 8. Start the agent process
echo "[8/10] Starting agent process..."
sprite exec "$SPRITE_NAME" -- bash -c "
  cd /opt/agent && \
  su agent -c 'nohup node dist/index.js > /self/logs/stdout.log 2>&1 &'
"

# 9. Make URL publicly accessible
echo "[9/10] Configuring public access..."
sprite url update "$SPRITE_NAME" --auth public

# 10. Create genesis checkpoint
echo "[10/10] Creating genesis checkpoint..."
sprite checkpoint create "$SPRITE_NAME" --comment "genesis-pre-first-awakening"

echo ""
echo "=== Deployment complete ==="
echo "Sprite: $SPRITE_NAME"
echo "URL:    https://$SPRITE_NAME.sprites.app/"
echo ""
echo "Monitor with:"
echo "  sprite exec $SPRITE_NAME -- tail -f /self/logs/agent.log"
echo "  sprite exec $SPRITE_NAME -- cat /self/journal.md"
echo "  sprite exec $SPRITE_NAME -- cat /income/balance.json"
