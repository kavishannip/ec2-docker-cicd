# Production CI/CD Deployment Pipeline Guide: GitHub Actions to AWS EC2 (Docker)

This guide documents the architecture, setup, and best practices for building an automated, resilient, and ultra-lightweight CI/CD pipeline from GitHub Actions to an AWS EC2 instance using Docker and Next.js Standalone output.

---

## 1. Architecture Overview

### The "Build in CI, Run in Production" Pattern

Compiling a modern TypeScript/Next.js application requires significant CPU and memory (**1.2 GB – 2 GB RAM** during bundling and typechecking). Running `next build` directly on an entry-level cloud instance (such as AWS `t2.micro` or `t3.micro` with 1 GB RAM) causes **Out-Of-Memory (OOM) kernel freezes**.

To eliminate this bottleneck, the pipeline follows the **Separation of Build & Runtime Environments**:

```mermaid
flowchart TD
    subgraph Local["1. Developer Machine"]
        Dev[Code & Commit] --> GitPush[git push origin main]
    end

    subgraph CI["2. GitHub Actions Runner (16 GB RAM)"]
        GitPush --> Setup[Setup Node.js 20 & npm ci]
        Setup --> Lint[Run ESLint]
        Lint --> Build[npm run build: Next.js Standalone]
        Build --> Bundle[Package .next/standalone + Dockerfile + .env into app.tar.gz ~18MB]
    end

    subgraph AWS["3. AWS EC2 Instance (1 GB RAM)"]
        Bundle -->|Native SCP over SSH with 15s Timeout| EC2Transfer[Transfer app.tar.gz]
        EC2Transfer --> DockerBuild[docker build in ~3s: No Compilation]
        DockerBuild --> PortCheck{Is Port 80 free?}
        PortCheck -->|Yes| BindBoth[-p 80:3000 and -p 3000:3000]
        PortCheck -->|No - e.g. Nginx/Apache| Bind3000[-p 3000:3000]
        BindBoth --> HealthCheck[curl localhost:3000 Health Check]
        Bind3000 --> HealthCheck
        HealthCheck --> Live[Live Application Running]
    end
```

---

## 2. Infrastructure Setup (AWS EC2)

### A. Instance Sizing & Operating System
* **Recommended OS:** Ubuntu 24.04 LTS or Amazon Linux 2023.
* **Instance Type:** `t2.micro` or `t3.micro` (AWS Free Tier eligible).

### B. Allocate an Elastic IP (Critical)
* By default, when an EC2 instance is stopped and started, AWS assigns a **new Public IPv4 address**.
* **Solution:** Navigate to **AWS EC2 Console &rarr; Network & Security &rarr; Elastic IPs**, allocate an Elastic IP, and associate it with your EC2 instance. This guarantees your IP never changes.

### C. Security Group Inbound Rules
Configure your EC2 Security Group with the following inbound rules:

| Type | Protocol | Port Range | Source | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| **SSH** | TCP | `22` | `0.0.0.0/0` | Enables GitHub Actions runners & SSH access |
| **HTTP** | TCP | `80` | `0.0.0.0/0` | Web traffic (direct browser access) |
| **Custom TCP** | TCP | `3000` | `0.0.0.0/0` | Application port |

> [!NOTE]
> GitHub Actions runners use dynamic IP addresses from Microsoft Azure / AWS ranges. Restricting SSH (Port 22) to `My IP` will block GitHub Actions from connecting.

### D. Add Swap Space (Safety Net for 1GB Instances)
Always configure a 2GB swap space on small instances to prevent kernel crashes if memory usage temporarily spikes:

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### E. Install Docker on EC2
Connect to your EC2 instance and run:

```bash
# Install Docker
sudo apt update && sudo apt install -y docker.io

# Allow non-root user to run Docker commands
sudo usermod -aG docker $USER

# Apply group changes immediately (or log out and back in)
newgrp docker

# Verify Docker service
docker version
```

---

## 3. GitHub Repository Configuration

Navigate to **GitHub Repository &rarr; Settings &rarr; Secrets and variables &rarr; Actions**, and add the following repository secrets:

| Secret Name | Example Value | Description |
| :--- | :--- | :--- |
| `EC2_HOST` | `54.210.123.45` | Public IPv4 or Elastic IP of the EC2 instance |
| `EC2_USER` | `ubuntu` | Default SSH user (`ubuntu` for Ubuntu, `ec2-user` for Amazon Linux) |
| `EC2_SSH_KEY` | `-----BEGIN RSA PRIVATE KEY-----...` | Entire contents of your `.pem` SSH private key |
| `OPENWEATHER_API_KEY` | `your_api_key_here` | Application API key injected into runtime `.env` |

---

## 4. Next.js Standalone Configuration

In your `next.config.ts`, enable standalone output:

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone", // Traces only required runtime files into .next/standalone
};

export default nextConfig;
```

### Ultra-Lightweight Standalone Dockerfile (`Dockerfile.standalone`)

Because the application is already compiled in CI, the production Docker image does not need Node package managers, build tools, or compilers:

```dockerfile
FROM node:20-alpine
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Create unprivileged user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy pre-compiled standalone files
COPY --chown=nextjs:nodejs . .

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
```

---

## 5. Complete CI/CD Workflow (`.github/workflows/deploy.yml`)

Here is the complete, hardened workflow that handles timeouts, secrets, package bundling, and adaptive port deployment:

```yaml
name: Deploy to AWS EC2

on:
  push:
    branches:
      - main
      - master
  workflow_dispatch:

jobs:
  build-and-deploy:
    name: Build & Deploy
    runs-on: ubuntu-latest
    timeout-minutes: 10 # Enforces a maximum execution ceiling to avoid hung jobs
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js 20
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: "npm"

      - name: Install dependencies
        run: npm ci

      - name: Run ESLint
        run: npm run lint

      # 1. Compile Next.js standalone on GitHub Runner (16GB RAM)
      - name: Build Next.js application
        run: npm run build

      # 2. Bundle standalone files + Dockerfile + environment config into a lightweight package (~18MB)
      - name: Prepare standalone deployment package
        env:
          OPENWEATHER_API_KEY: ${{ secrets.OPENWEATHER_API_KEY }}
        run: |
          cp -r public .next/standalone/public
          cp -r .next/static .next/standalone/.next/static
          cp Dockerfile.standalone .next/standalone/Dockerfile
          echo "OPENWEATHER_API_KEY=${OPENWEATHER_API_KEY}" > .next/standalone/.env
          cd .next/standalone && tar -czf ../../app.tar.gz .

      # 3. Deploy to EC2 via native SSH & SCP with strict connection timeouts
      - name: Deploy to AWS EC2
        env:
          EC2_HOST: ${{ secrets.EC2_HOST }}
          EC2_USER: ${{ secrets.EC2_USER }}
          EC2_KEY: ${{ secrets.EC2_SSH_KEY }}
        run: |
          set -e

          # Setup SSH private key
          mkdir -p ~/.ssh
          echo "$EC2_KEY" > ~/.ssh/id_rsa
          sed -i 's/\r$//' ~/.ssh/id_rsa
          chmod 600 ~/.ssh/id_rsa

          echo "=================================================="
          echo ">>> 1. Testing SSH connectivity to $EC2_USER@$EC2_HOST..."
          echo "=================================================="
          if ! ssh -o StrictHostKeyChecking=no -o ConnectTimeout=15 -o BatchMode=yes "$EC2_USER@$EC2_HOST" "echo 'SSH connection verified!'"; then
            echo "::error::SSH connection to $EC2_USER@$EC2_HOST timed out or failed!"
            echo "Check: 1) Is EC2 running? 2) Is Port 22 open to 0.0.0.0/0? 3) Did the Public IP change?"
            exit 1
          fi

          echo "=================================================="
          echo ">>> 2. Transferring application bundle..."
          echo "=================================================="
          ssh -o StrictHostKeyChecking=no "$EC2_USER@$EC2_HOST" "mkdir -p ~/app"
          scp -o StrictHostKeyChecking=no -o ConnectTimeout=30 app.tar.gz "$EC2_USER@$EC2_HOST":~/app/app.tar.gz

          echo "=================================================="
          echo ">>> 3. Building and launching Docker container..."
          echo "=================================================="
          ssh -o StrictHostKeyChecking=no "$EC2_USER@$EC2_HOST" "bash -s" << 'EOF'
            set -e

            cd ~/app
            echo ">>> Extracting pre-built application..."
            tar -xzf app.tar.gz
            rm -f app.tar.gz

            echo ">>> Building standalone Docker container..."
            docker build -t ec2-cicd-weather .

            echo ">>> Stopping previous container..."
            docker rm -f weather-app 2>/dev/null || true

            # Adaptive Port Allocation: Check if port 80 is occupied (e.g. by host Nginx or Apache)
            PORT_FLAGS="-p 3000:3000"
            if sudo ss -lptn 'sport = :80' 2>/dev/null | grep -q LISTEN || ss -tuln 2>/dev/null | grep -q ':80 '; then
              echo ">>> Notice: Port 80 is occupied by a host service. Binding exclusively to port 3000."
            else
              echo ">>> Port 80 is free. Exposing container on both port 80 and port 3000."
              PORT_FLAGS="-p 80:3000 -p 3000:3000"
            fi

            echo ">>> Starting new container ($PORT_FLAGS)..."
            docker run -d \
              --name weather-app \
              $PORT_FLAGS \
              --env-file .env \
              --restart unless-stopped \
              ec2-cicd-weather

            echo ">>> Pruning dangling images..."
            docker image prune -f

            echo ">>> Verifying running container status..."
            docker ps --filter "name=weather-app"

            echo ">>> Testing local health check..."
            sleep 3
            curl -s -o /dev/null -w ">>> HTTP Status: %{http_code}\n" http://127.0.0.1:3000/ || true

            echo ">>> Deployment successfully finished!"
          EOF
```

---

## 6. Common Pitfalls & Troubleshooting Matrix

| Issue | Root Cause | Solution |
| :--- | :--- | :--- |
| **`Run Command Timeout` during build** | `next build` executed on 1GB RAM EC2 caused an Out-Of-Memory (OOM) freeze. | Build with Next.js `output: "standalone"` on the GitHub runner and transfer the pre-compiled bundle. |
| **Workflow hangs for 30+ minutes** | Action lacks connection timeout and waits for default 6-hour limit. | Add `timeout-minutes: 10` to the job and `ConnectTimeout=15` to SSH/SCP commands. |
| **`bind: address already in use` (Port 80)** | Host service (`apache2`, `nginx`) already occupies port 80 on EC2. | Use adaptive port detection (`PORT_FLAGS`) in bash script, or stop the conflicting service via `sudo systemctl stop nginx apache2`. |
| **`SSH Connection Refused / Timed Out`** | EC2 instance rebooted without an Elastic IP (IP changed), or Security Group restricted to `My IP`. | Verify current Public IPv4 address in AWS Console, update `EC2_HOST` secret, and open port 22 to `0.0.0.0/0`. |
| **`Conflict: Container name already in use`** | A previously failed `docker run` left an orphaned container. | Always run `docker rm -f <container-name> 2>/dev/null \|\| true` prior to starting a container. |
| **Invalid SSH Private Key formatting** | Windows `\r\n` carriage returns in GitHub Secrets. | Run `sed -i 's/\r$//' ~/.ssh/id_rsa` and `chmod 600 ~/.ssh/id_rsa` in CI. |
