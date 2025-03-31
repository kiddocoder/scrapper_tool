"use strict";
const {
  RequestQueue,
  PuppeteerCrawler,
  Configuration,
  utils,
  KeyValueStore,
} = require("crawlee");
const { PROXY_HOST, CRAWLEE_MIN_CONCURRENCY, CRAWLEE_MAX_CONCURRENCY } =
  process.env;

const { md5 } = require("../md5");
const { sleep, googleMapConsentCheck } = require("../utils");
const { logger } = require("../log");
const { parseTextDuration } = require("../time");
const { client: redisClient } = require("../redis");
const { getGoogleMap, insertGoogleMap } = require("./model");
const { PUPPETEER_MINIMAL_ARGS, BROWSER_POOL_OPTIONS } = require("../const");

const googleMapAddressTaskQueue = "googlemap:address:task:queue";
const googleMapAddressTaskErrorQueue = "googlemap:address:task:error:queue";

const googleMapAddressTaskSuccess = "googlemap:address:task:success";
const googleMapAddressTaskFailure = "googlemap:address:task:failure";
var store;
var hasMore = true;
var handledSignal = false;

async function scrollPage(page, scrollContainer, limit = 30) {
  let count = 0;
  while (true) {
    if (count >= limit) {
      logger.error(`reached scoll page limit ${limit} , url ${page.url()}`);
      break;
    }
    let lastHeight = await page.evaluate(
      `document.querySelector("${scrollContainer}").scrollHeight`
    );
    logger.info(`scrollPage lastHeight ${lastHeight}`);
    await page.evaluate(
      `document.querySelector("${scrollContainer}").scrollTo(0, document.querySelector("${scrollContainer}").scrollHeight)`
    );
    count++;
    await page.waitForTimeout(2000);
    let newHeight = await page.evaluate(
      `document.querySelector("${scrollContainer}").scrollHeight`
    );
    if (await page.$("span.xRkPPb")) {
      const dates = await page.evaluate(() => {
        return Array.from(document.querySelectorAll("span.xRkPPb")).map(
          (el) => {
            console.log(`date ${el.innerText.trim().split("on")[0]}`);
            return el.innerText.trim().split("on")[0];
          }
        );
      });
      const date = dates[dates.length - 1];
      if (date && (date.includes("year ago") || date.includes("years ago"))) {
        break;
      }
    }
    if (await page.$("span.rsqaWe")) {
      const dates = await page.evaluate(() => {
        return Array.from(document.querySelectorAll("span.rsqaWe")).map(
          (el) => {
            return el.innerText.trim();
          }
        );
      });
      const date = dates[dates.length - 1];
      if (date && (date.includes("year ago") || date.includes("years ago"))) {
        break;
      }
      lastHeight = newHeight;
    }
  }
}

const processAbout = async (page) => {
  if (!(await page.$("button[aria-label*='About']"))) {
    return null;
  }
  await page.click("button[aria-label*='About']");
  await sleep(500);
  if (!(await page.$("h2"))) {
    return null;
  }
  await page.waitForSelector("h2", { timeout: 1000 * 10 });
  const list = await page.$$("div.fontBodyMedium");
  var data = {};
  if (list.length === 1) {
    const text = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("div.P1LL5e")).map((el) => {
        return el.innerText.trim();
      });
    });
    const attrs = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("div.WKLD0c .CK16pd")).map(
        (el) => {
          return el.getAttribute("aria-label");
        }
      );
    });
    return text.join("\n") + "\n" + attrs.join("\n");
  }
  for (let item of list) {
    if (!(await item.$("h2"))) {
      continue;
    }
    let title = await item.$eval("h2", (el) => el.innerText);
    const texts = await item.$$("li");
    let items = [];
    for (let t of texts) {
      const text = await t.$eval("span", (el) => el.getAttribute("aria-label"));
      items.push(text);
    }
    data[title] = items;
  }
  return data;
};

const processReviews = async (page) => {
  if (!(await page.$("button[aria-label*='Reviews']"))) {
    return null;
  }
  await page.click("button[aria-label*='Reviews']");

  await page.waitForSelector(
    "button[aria-label*='relevant'], button[aria-label*='Sort']",
    { timeout: 1000 * 10 }
  );
  if (await page.$("button[aria-label*='relevant']")) {
    await page.click("button[aria-label*='relevant']");
  } else if (await page.$("button[aria-label*='Sort']")) {
    await page.click("button[aria-label*='Sort']");
  }

  await page.waitForSelector("div[id='action-menu'] div[data-index='1']", {
    timeout: 1000 * 10,
  });

  if (!(await page.$("div[id='action-menu'] div[data-index='1']"))) {
    return null;
  }
  await page.click("div[id='action-menu'] div[data-index='1']");
  await page.waitForSelector("div.d4r55", { timeout: 1000 * 10 });
  const start = Date.now();
  await scrollPage(page, ".DxyBCb");
  logger.info(
    `processReviews scrollPage cost time ${(Date.now() - start) / 1000} s`
  );
  const reviews = await page.evaluate(() => {
    return Array.from(document.querySelectorAll(".jftiEf")).map((el) => {
      return {
        user: {
          name: el.querySelector(".d4r55")?.textContent.trim(),
          link: el.querySelector(".WNxzHc a")?.getAttribute("href"),
          thumbnail: el.querySelector(".NBa7we")?.getAttribute("src"),
          localGuide:
            el.querySelector(".RfnDt span:first-child")?.style.display ===
            "none"
              ? undefined
              : true,
          reviews: parseInt(
            el
              .querySelector(".RfnDt span:last-child")
              ?.textContent.replace("·", "")
          ),
        },
        rating: parseFloat(
          el.querySelector(".kvMYJc")?.getAttribute("aria-label") ||
            parseInt(el.querySelector(".fzvQIb")?.textContent.split("/")[0]) / 5
        ),
        snippet: el.querySelector(".MyEned")?.textContent.trim(),
        date:
          el.querySelector(".rsqaWe")?.textContent.trim() ||
          el.querySelector(".xRkPPb")?.textContent.trim().split(" on")[0],
      };
    });
  });
  return reviews.map((r) => {
    r.date = new Date(Date.now() - parseTextDuration(r.date) * 1000);
    return r;
  });
};

const processMapItem = async (page) => {
  const url = page.url();
  const title = await page.$eval("h1", (el) => el.innerText);
  const review_el = (await page.$("div.F7nice"))
    ? await page.$eval("div.F7nice", (el) => el.innerText)
    : "";
  const star = parseFloat(review_el?.split("(")[0] || 0);
  const review_count = parseInt(
    review_el?.split("(").length >= 2
      ? review_el?.split("(")[1].split(")")[0]
      : 0
  );
  const headline = (await page.$(
    "div[aria-label*='About'] div[jslog*='metadata']"
  ))
    ? await page.$eval(
        "div[aria-label*='About'] div[jslog*='metadata']",
        (el) => el.innerText
      )
    : "";
  const category = (await page.$("button[jsaction='pane.rating.category']"))
    ? await page.$eval(
        "button[jsaction='pane.rating.category']",
        (el) => el.innerText
      )
    : (await page.$("span.mgr77e"))
    ? await page.$eval("span.mgr77e", (el) => el.innerText)
    : null;
  let address = (await page.$("button[data-item-id='address']"))
    ? await page.$eval("button[data-item-id='address']", (el) =>
        el.getAttribute("aria-label")
      )
    : "";
  address = address.replace("Address: ", "");
  const openHours = (await page.$("div[aria-label*='Sunday']"))
    ? await page.$eval("div[aria-label*='Sunday']", (el) =>
        el.getAttribute("aria-label")
      )
    : null;
  const checkIn = (await page.$(
    "div[data-item-id='place-info-links:'] .Io6YTe"
  ))
    ? await page.$eval(
        "div[data-item-id='place-info-links:'] .Io6YTe",
        (el) => el.innerText
      )
    : null;
  const book = (await page.$("a.M77dve"))
    ? await page.$eval("a.M77dve", (el) => el.getAttribute("href"))
    : null;

  const website = (await page.$("a[data-item-id='authority']"))
    ? await page.$eval("a[data-item-id='authority']", (el) =>
        el.getAttribute("href")
      )
    : null;
  const phone = (await page.$("button[aria-label*='Phone']"))
    ? await page.$eval("button[aria-label*='Phone']", (el) => el.innerText)
    : null;
  const pluscode = (await page.$("button[aria-label*='Plus code']"))
    ? await page.$eval("button[aria-label*='Plus code']", (el) => el.innerText)
    : null;
  let start = Date.now();
  const about = await processAbout(page);
  logger.info(
    `processAbout cost time ${(Date.now() - start) / 1000} s | ${url}`
  );
  start = Date.now();
  const review = await processReviews(page);
  logger.info(
    `processReviews cost time ${(Date.now() - start) / 1000} s | ${url}`
  );
  const coordinate = parseCoordinateFromMapUrl(url);
  const result = {
    url: url,
    title: title,
    star: star,
    review_count: review_count,
    headline: headline,
    category: category,
    address: address,
    openHours: openHours,
    checkIn: checkIn,
    book: book,
    website: website,
    phone: phone,
    pluscode: pluscode,
    coordinate: coordinate,
    about: about,
    review: review,
  };
  return result;
};

const processMap = async (page, url) => {
  if (!url) {
    logger.error(`sleeping | url queue is empty!`);
    await sleep(10000);
    return false;
  }
  logger.info(`visiting url: ${url}`);
  await googleMapConsentCheck(page);
  await page.waitForSelector("h1", { timeout: 10 * 1000 });
  await waitTillHTMLRendered(page);

  const start = Date.now();
  const result = await processMapItem(page);
  logger.info(
    `processMapItem cost time ${
      (Date.now() - start) / 1000
    } s || ${JSON.stringify(result)}`
  );

  result["id"] = parseMapId(url);
  const ok = await insertGoogleMap(result);
  if (ok) {
    logger.info(
      `google map ${result.title} is insertted into db successfully!`
    );
  }
  return true;
};

const config = Configuration.getGlobalConfig();
config.set("disableBrowserSandbox", true);

const preNavigationHook = async (crawlingContext, gotoOptions) => {
  const { request } = crawlingContext;
  const url = request.url;
  if (url.includes("www.google.com/maps/place")) {
    await store.setValue(request.id, url);
  }
};

const requestHandler = async ({ page, request }) => {
  const url = request.url;

  if (!url.includes("www.google.com/maps/place")) {
    await store.setValue(request.id, null);
    logger.error(`illegal address ${url}`);
    return;
  }
  const start = Date.now();
  await page.waitForNetworkIdle();
  logger.info(`Processing: ${url}`);
  const result = await processMap(page, url);
  if (result) {
    await redisClient.incr(googleMapAddressTaskSuccess);
    logger.info(
      `scraping address info cost time ${(Date.now() - start) / 1000} s`
    );
  }
  await store.setValue(request.id, null);
};

const errorHandler = async ({ request, error }) => {
  logger.error(`errorHandler | error found: ${request.url}, err: ${error}`);
};

const failedRequestHandler = async ({ request, error }) => {
  await redisClient.incr(googleMapAddressTaskFailure);
  const url = request.url;
  logger.error(`failedRequestHandler | error:${request.url}, err: ${error}`);
  const errMsg = error?.message.toLowerCase() || "";
  if (errMsg.includes("timeout") || errMsg.includes("net::err")) {
    logger.error(`${url} is putting back to queue!`);
    await redisClient.lPush(googleMapAddressTaskQueue, url);
    return;
  }
  logger.error(`${url} is putting back to error queue | errMsg: ${errMsg}`);
  await redisClient.lPush(googleMapAddressTaskErrorQueue, url);
};

const backupRequestQueue = async (queue, store, signal) => {
  if (handledSignal) {
    logger.info(`${signal} already handled`);
    return;
  }
  handledSignal = true;
  logger.info(`GOT ${signal}, backing up!`);
  let count = 0;
  for (const [key, value] of Object.entries(queue?.queueHeadDict?.dictionary)) {
    const qResult = await queue.getRequest(key);
    if (!qResult.url.includes("www.google.com/maps/place")) {
      continue;
    }
    count += 1;
    logger.info(
      `${signal} signal recieved, backing up key: ${key} | request: ${qResult.url}`
    );
    redisClient.lPush(googleMapAddressTaskQueue, qResult.url);
  }
  logger.info(`tasks in queue count: ${count}`);
  count = 0;
  await store.forEachKey(async (key, index, info) => {
    count += 1;
    const val = await store.getValue(key);
    logger.info(`running tasks: key: ${key} url:  ${val}`);
    if (val) {
      redisClient.lPush(googleMapAddressTaskQueue, val);
    }
  });
  logger.info(`running tasks count: ${count}`);
};

async function index() {
  store = await KeyValueStore.open("google-map-item");
  const queue = await RequestQueue.open("google-map-item");
  var crawler = new PuppeteerCrawler({
    launchContext: {
      launchOptions: {
        handleSIGINT: false,
        handleSIGTERM: false,
        // Other Puppeteer options
      },
    },
    requestQueue: queue,
    headless: true,
    browserPoolOptions: BROWSER_POOL_OPTIONS,
    navigationTimeoutSecs: 2 * 60,
    requestHandlerTimeoutSecs: 5 * 60,
    keepAlive: true,
    maxRequestRetries: 3,
    minConcurrency: CRAWLEE_MIN_CONCURRENCY | 1,
    maxConcurrency: CRAWLEE_MAX_CONCURRENCY | 3,
    preNavigationHooks: [preNavigationHook],
    requestHandler: requestHandler,
    errorHandler: errorHandler,
    failedRequestHandler: failedRequestHandler,
  });
  ["SIGINT", "SIGTERM", "uncaughtException"].forEach((signal) =>
    process.on(signal, async () => {
      await backupRequestQueue(queue, store, signal);
      await crawler.teardown();
      await sleep(200);
      process.exit(1);
    })
  );

  var url;
  var errCount = 0;
  crawler.run();
  while (true) {
    const queueSize = queue?.queueHeadDict?.linkedList.length || 0;
    logger.info(
      `crawler status ${crawler.running} , queue size is ${queueSize}`
    );
    if (!crawler.running || queueSize > 10) {
      await sleep(1000);
      if (!crawler.running) {
        crawler.run();
      }
      continue;
    }

    url = await redisClient.lPop(googleMapAddressTaskQueue);
    const start = Date.now();
    try {
      if (!url) {
        const s = 5 * 1000;
        logger.error(`url is empty | sleeping ${s} ms`);
        await sleep(s);
        continue;
      }
      const mapId = parseMapId(url);
      if (!mapId) {
        logger.error(`mapId is empty, url ${url}`);
        continue;
      }
      if (!url.includes("www.google.com/maps/place")) {
        logger.error(`illegal address ${url}`);
        continue;
      }
      const ok = await getGoogleMap(mapId);
      if (ok) {
        logger.info(`already processed ${url}, bypassing`);
        continue;
      }
      const param = "?authuser=0&hl=en&rclk=1";
      if (!url.includes(param)) {
        url += param;
      }
      logger.info(`new url added ${url}`);
      await crawler.addRequests([url]);
      await sleep(500);
    } catch (e) {
      logger.error(e);
      await redisClient.incr(googleMapAddressTaskFailure);
      errCount++;
      logger.error(
        `url: ${url}, err: ${e}, proxy: ${PROXY_HOST} | scraping address info cost time ${
          (Date.now() - start) / 1000
        } s`
      );
      const errMsg = e.message?.toLowerCase() || "";
      if (errMsg.includes("timeout") || errMsg.includes("net::err")) {
        logger.error(`${url} is putting back to queue!`);
        await redisClient.lPush(googleMapAddressTaskQueue, url);
        continue;
      }
      await redisClient.lPush(googleMapAddressTaskErrorQueue, url);
      await sleep(400);
    }
  }
}
