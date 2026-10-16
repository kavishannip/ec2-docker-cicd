# TimeSpot: Weather & World Clock App (AWS EC2 CI/CD)

A responsive Next.js weather dashboard and world clock inspired by modern industrial UI design. Features real-time local and global time calculations, weather outlooks, dynamic day/night ambient calculations, metric/imperial toggles, and an automated zero-OOM CI/CD deployment pipeline to AWS EC2 using Docker.

---

## Tech Stack

* **Frontend:** Next.js 15 (App Router, Standalone), React 19, Tailwind CSS, Lucide React
* **Weather API:** OpenWeather Current & 5-Day Forecast API
* **Containerization:** Docker (`node:20-alpine` standalone runner, ~72MB image)
* **CI/CD:** GitHub Actions (with fail-fast timeouts and artifact bundling)
* **Hosting:** AWS EC2 (`t2.micro` / `t3.micro`)

---

## Getting Started Locally

### 1. Prerequisites
* Node.js 20+
* OpenWeather API Key ([Get one free](https://openweathermap.org/api))

### 2. Environment Setup
Create a `.env` file in the project root:

```env
OPENWEATHER_API_KEY=your_openweather_api_key_here
```

### 3. Install & Run
```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Running with Docker Locally

To build and run the container locally:

```bash
# Build image
docker build -t weather-app .

# Run container
docker run -d --name weather-app -p 3000:3000 --env-file .env --restart unless-stopped weather-app
```

---

## Automated CI/CD Deployment to AWS EC2

Every push to the `main` branch triggers an automated GitHub Actions workflow ([`.github/workflows/deploy.yml`](file:///.github/workflows/deploy.yml)):

1. **Lint & Test:** Runs ESLint on GitHub Actions.
2. **Compile in CI (16GB RAM):** Builds Next.js in standalone mode to prevent OOM memory freezes on small EC2 instances.
3. **Artifact Bundling:** Packages only runtime assets (~18MB).
4. **Deploy over SSH:** Transfers package to EC2, launches the container in Docker with health checks, and handles host port conflicts dynamically.

### Required GitHub Repository Secrets

Configure these in **GitHub Repository &rarr; Settings &rarr; Secrets and variables &rarr; Actions**:

* `EC2_HOST`: Public IPv4 address or Elastic IP of your EC2 instance.
* `EC2_USER`: SSH username (`ubuntu` or `ec2-user`).
* `EC2_SSH_KEY`: Private RSA SSH key (`.pem` file content).
* `OPENWEATHER_API_KEY`: Your OpenWeather API key.

---

## Deployment Documentation

For the complete step-by-step production architecture, security group rules, swap configuration, and troubleshooting guide, see [**DEPLOYMENT_PIPELINE_GUIDE.md**](file:///DEPLOYMENT_PIPELINE_GUIDE.md).
