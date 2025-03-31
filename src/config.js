const path = require("path");
require("dotenv").config();

class ConfigLoader {
  constructor() {
    this.config = {
      crawler: {
        minConcurrency: parseInt(process.env.CRAWLEE_MIN_CONCURRENCY || "1"),
        maxConcurrency: parseInt(process.env.CRAWLEE_MAX_CONCURRENCY || "2"),
        retryCount: parseInt(process.env.MAX_RETRIES || "3"),
        retryDelay: parseInt(process.env.RETRY_DELAY_MS || "5000"),
      },
      redis: {
        host: process.env.REDIS_HOST || "localhost",
        port: parseInt(process.env.REDIS_PORT || "6379"),
        password: process.env.REDIS_PASSWORD || undefined,
        db: parseInt(process.env.REDIS_DB || "0"),
      },
      proxy: this.getProxyConfig(),
      browser: {
        headless: process.env.PUPPETEER_HEADLESS === "true",
        width: parseInt(process.env.PUPPETEER_WINDOW_WIDTH || "1920"),
        height: parseInt(process.env.PUPPETEER_WINDOW_HEIGHT || "1080"),
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
      },
      storage: {
        path: process.env.STORAGE_PATH || path.join(__dirname, "storage"),
        type: process.env.STORAGE_TYPE || "local",
      },
      logging: {
        level: process.env.LOG_LEVEL || "debug",
        filePath:
          process.env.LOG_FILE_PATH ||
          path.join(__dirname, "logs", "crawler.log"),
      },
    };
  }

  getProxyConfig() {
    // Only return proxy config if PROXY_HOST is set
    if (process.env.PROXY_HOST) {
      return {
        host: process.env.PROXY_HOST,
        port: parseInt(process.env.PROXY_PORT || "8080"),
        username: process.env.PROXY_USERNAME,
        password: process.env.PROXY_PASSWORD,
      };
    }
    return null;
  }

  get() {
    return this.config;
  }

  // Helper method to ensure required directories exist
  async ensureDirectories() {
    const fs = require("fs").promises;
    const dirs = [
      path.dirname(this.config.logging.filePath),
      this.config.storage.path,
    ];

    for (const dir of dirs) {
      await fs.mkdir(dir, { recursive: true }).catch((err) => {
        if (err.code !== "EEXIST") throw err;
      });
    }
  }
}

module.exports = new ConfigLoader();
