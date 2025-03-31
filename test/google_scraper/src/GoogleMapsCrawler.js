import { firefox } from "playwright";

class GoogleMapsCrawler {
  constructor() {
    this.browser = null;
    this.page = null;
    this.targetWebsite = "https://www.google.com/maps/";
  }

  async init() {
    this.browser = await firefox.launch({
      headless: false,
    });
    this.page = await this.browser.newPage();
  }

  async test() {
    return "i'm testing man";
  }

  async stopScrolling(page, container, _el) {
    return await page.$eval(_el);
  }

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

      if (this.stopScrolling(page, container, _el)) {
        // if this element appear then stop scrolling.
        break;
      }

      count++;
    }
  }

  async handleRequest(query) {
    await this.page.goto(this.targetWebsite);

    // Type the search query and submit the form
    await this.page.fill("input[id='searchboxinput']", query);
    await this.page.press("input[id='searchboxinput']", "Enter");
    await this.page.waitForNavigation();

    // Retrieve search results from the sidebar
    const results = await this.page.$$(
      "div[class*='section-result'] > div[class*='result-container']"
    );

    const data = [];

    for (const result of results) {
      const title = await result.$eval("h3", (el) => el.textContent);
      const address = await result.$eval(
        "div[class*='section-result-content'] > div[class*='result-address']",
        (el) => el.textContent
      );

      data.push({ title, address, longitude: null, latitude: null });
    }

    return data;
  }

  async run(query) {
    await this.init();
    const data = await this.handleRequest(query);
    await this.browser.close();
    return data;
  }
}

export default GoogleMapsCrawler;
