// "use strict";

const {
  RequestQueue,
  PuppeteerCrawler,
  Configuration,
  KeyValueStore,
} = require("crawlee");
const { logger } = require("./logs");
const { parseTextDuration } = require("./times");

class GoogleMapsCrawler {
  constructor() {
    this.handledSignal = false;
    this.crawler = null;
  }

  /**
   * Scrolls a page container to load more content
   */
  async scrollPage(page, scrollContainer, _limit = 30) {
    let count = 0;

    while (count < _limit) {
      const lastHeight = await page.evaluate(
        `document.querySelector("${scrollContainer}").scrollHeight`
      );

      await page.evaluate(
        `document.querySelector("${scrollContainer}").scrollTo(0, document.querySelector("${scrollContainer}").scrollHeight)`
      );

      await page.waitForTimeout(2000);

      // Check for date markers that indicate we've scrolled far enough
      const dates = await this.getReviewDates(page);
      if (dates && this.shouldStopScrolling(dates)) {
        break;
      }

      count++;
    }
  }

  /**
   * Processes the "About" section of a Google Maps place
   */
  async processAbout(page) {
    if (!(await page.$("button[aria-label*='About']"))) {
      return null;
    }

    await page.click("button[aria-label*='About']");
    await page.waitForTimeout(500);

    try {
      await page.waitForSelector("h2", { timeout: 10000 });
      const sections = await page.$$("div.fontBodyMedium");

      // Handle single section case
      if (sections.length === 1) {
        return this.processSingleAboutSection(page);
      }

      // Handle multiple sections
      return this.processMultipleAboutSections(sections, page);
    } catch (error) {
      logger.error(`Error processing about section: ${error.message}`);
      return null;
    }
  }

  /**
   * Processes the reviews section of a Google Maps place
   */
  async processReviews(page) {
    if (!(await page.$("button[aria-label*='Reviews']"))) {
      return null;
    }

    try {
      await this.setupReviewsSort(page);
      await this.scrollPage(page, ".DxyBCb");

      const reviews = await page.evaluate(() => {
        return Array.from(document.querySelectorAll(".jftiEf")).map((el) => ({
          user: {
            name: el.querySelector(".d4r55")?.textContent.trim(),
            link: el.querySelector(".WNxzHc a")?.getAttribute("href"),
            thumbnail: el.querySelector(".NBa7we")?.getAttribute("src"),
            localGuide:
              el.querySelector(".RfnDt span:first-child")?.style.display !==
              "none",
            reviews: parseInt(
              el
                .querySelector(".RfnDt span:last-child")
                ?.textContent.replace("·", "")
            ),
          },
          rating: parseFloat(
            el.querySelector(".kvMYJc")?.getAttribute("aria-label") ||
              parseInt(el.querySelector(".fzvQIb")?.textContent.split("/")[0]) /
                5
          ),
          snippet: el.querySelector(".MyEned")?.textContent.trim(),
          date:
            el.querySelector(".rsqaWe")?.textContent.trim() ||
            el.querySelector(".xRkPPb")?.textContent.trim().split(" on")[0],
        }));
      });

      return reviews.map((review) => ({
        ...review,
        date: new Date(Date.now() - parseTextDuration(review.date) * 1000),
      }));
    } catch (error) {
      logger.error(`Error processing reviews: ${error.message}`);
      return null;
    }
  }

  /**
   * Processes a single Google Maps place
   */
  async processMapItem(page) {
    const url = page.url();
    const data = await this.extractBasicInfo(page);

    const [about, reviews] = await Promise.all([
      this.processAbout(page),
      this.processReviews(page),
    ]);

    return {
      ...data,
      url,
      about,
      reviews,
      coordinate: this.parseCoordinateFromMapUrl(url),
    };
  }

  /**
   * Initializes and runs the crawler
   */
  async initialize() {
    this.store = await KeyValueStore.open("google-map-item");
    const queue = await RequestQueue.open("google-map-item");

    this.crawler = new PuppeteerCrawler({
      requestQueue: queue,
      headless: true,
      browserPoolOptions: {
        useFingerprints: false,
        fingerprintOptions: {
          screen: { width: 1920, height: 1080 },
        },
      },
      navigationTimeoutSecs: 120,
      requestHandlerTimeoutSecs: 300,
      maxRequestRetries: 3,
      minConcurrency: process.env.CRAWLEE_MIN_CONCURRENCY || 1,
      maxConcurrency: process.env.CRAWLEE_MAX_CONCURRENCY || 3,
      preNavigationHooks: [this.preNavigationHook.bind(this)],
      requestHandler: this.requestHandler.bind(this),
      failedRequestHandler: this.failedRequestHandler.bind(this),
    });

    this.setupSignalHandlers();
    await this.startCrawling(queue);
  }

  /**
   * Main crawler loop
   */
  async startCrawling(queue) {
    this.crawler.run();

    while (true) {
      try {
        await this.processNextUrl(queue);
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (error) {
        logger.error(`Crawler error: ${error.message}`);
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }
}

// Export the crawler
module.exports = GoogleMapsCrawler;
