// import { PlaywrightCrawler } from "crawlee";
// const { name, zipcode, near } = {
//   name: "busness",
//   zipcode: "00501",
//   near: "uk",
// };
// const searchBoxInput = "input#searchboxinput";
// const crawler = new PlaywrightCrawler({
//   requestHandler: async ({ page, request, enqueueLinks }) => {
//     console.log(`Processing: ${request.url}`);
//     page.goto(request.url);
//     await page.waitForSelector("form#XmI62e"); // wait for the form to appear
//     enqueueLinks({ selector: "form#XmI62e" }); // enqueue all links on the page

//     // fill the form
//     await page.fill(searchBoxInput, `${name} near ${zipcode} ${near}`);

//     // submit the form
//     await page.click("button#searchbox-searchbutton");
//   },
//   //   navigationTimeoutSecs: 360,
//   //   maxRequestRetries: 150,
//   // Let's limit our crawls to make our tests shorter and safer.
//   //   maxRequestsPerCrawl: 50,
// });

// await crawler.run(["https://google.com/maps"]);

import { PlaywrightCrawler } from "crawlee";

const crawler = new PlaywrightCrawler({
  requestHandler: async ({ page, request, enqueueLinks }) => {
    console.log(`Processing: ${request.url}`);
    await page.goto("/maps/search/");
    if (request.label === "DETAIL") {
      const urlPart = request.url.split("/").slice(-1); // ['sennheiser-mke-440-professional-stereo-shotgun-microphone-mke-440']
      const manufacturer = urlPart[0].split("-")[0]; // 'sennheiser'

      const title = await page.locator(".product-meta h1").textContent();
      const sku = await page
        .locator("span.product-meta__sku-number")
        .textContent();

      const priceElement = page
        .locator("span.price")
        .filter({
          hasText: "$",
        })
        .first();

      const currentPriceString = await priceElement.textContent();
      const rawPrice = currentPriceString.split("$")[1];
      const price = Number(rawPrice.replaceAll(",", ""));

      const inStockElement = page
        .locator("span.product-form__inventory")
        .filter({
          hasText: "In stock",
        })
        .first();

      const inStock = (await inStockElement.count()) > 0;

      const results = {
        url: request.url,
        manufacturer,
        title,
        sku,
        currentPrice: price,
        availableInStock: inStock,
      };

      console.log(results);
    } else if (request.label === "CATEGORY") {
      // We are now on a category page. We can use this to paginate through and enqueue all products,
      // as well as any subsequent pages we find

      await page.waitForSelector(".product-item > a");
      await enqueueLinks({
        selector: ".product-item > a",
        label: "DETAIL", // <= note the different label
      });

      // Now we need to find the "Next" button and enqueue the next page of results (if it exists)
      const nextButton = await page.$("a.pagination__next");
      if (nextButton) {
        await enqueueLinks({
          selector: "a.pagination__next",
          label: "CATEGORY", // <= note the same label
        });
      }
    } else {
      // This means we're on the start page, with no label.
      // On this page, we just want to enqueue all the category pages.

      await page.waitForSelector(".collection-block-item");
      await enqueueLinks({
        selector: ".collection-block-item",
        label: "CATEGORY",
      });
    }
  },
  //   navigationTimeoutSecs: 120,
  //   maxRequestRetries: 50,
  //   // Let's limit our crawls to make our tests shorter and safer.
  //   maxRequestsPerCrawl: 50,
});

await crawler.run(["https://google.com"]);
