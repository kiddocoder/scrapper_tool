/**
 * This script is a web scraping tool built using Node.js, Express, and Puppeteer.
 * It automates the process of scraping business data from Google Maps for a specified location.
 *
 * The tool does the following:
 * 1. Sets up an Express server that listens on port 3000.
 * 2. Uses Puppeteer to launch a headless Chrome browser instance.
 * 3. Navigates to Google Maps and searches for businesses in a given location (e.g., "Business near Bujumbura Burundi").
 * 4. Waits for the results to load and scrapes relevant data for each business, including:
 *    - Business name
 *    - Rating
 *    - Number of reviews
 *    - Opening and closing hours
 *    - Phone number
 *    - Address
 *    - Website link
 * 5. Removes duplicate entries based on business names to ensure unique results.
 * 6. Exposes a GET endpoint (/scrape) that triggers the scraping process and returns the scraped data in JSON format.
 *
 * To run this tool:
 * - Ensure you have Node.js and npm installed.
 * - Install the required dependencies by running `npm install express puppeteer`.
 * - Adjust the `chromePath` variable if necessary to point to your local Puppeteer installation of Chrome.
 * - Start the server by running `node your_script_file.js`.
 * - Access the scraping functionality by visiting `http://localhost:3000/scrape` in your web browser.
 */

const express = require("express");
const puppeteer = require("puppeteer");
const app = express();
const port = 3000;

const chromePath =
  "/home/kiddo/.cache/puppeteer/chrome/linux-130.0.6723.69/chrome-linux64/chrome";

async function scrapeData() {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: chromePath,
  });

  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({
    "Accept-Language": "en-US,en;q=0.9",
  });

  await page.goto("https://www.google.com/maps/");
  await page.type("#searchboxinput", "Business near Bujumbura Burundi");
  await page.click("#searchbox-searchbutton");
  await page.waitForSelector(".Nv2PK.tH5CWc.THOPZb");

  const data = await page.evaluate(() => {
    const results = [];
    const items = document.querySelectorAll(".Nv2PK.tH5CWc.THOPZb");
    items.forEach((item) => {
      const businessName =
        item.querySelector("a.hfpxzc")?.getAttribute("aria-label") || "";
      const rating =
        item.querySelector(".AJB7ye .e4rVHe.fontBodyMedium .ZkP5Je .MW4etd")
          ?.textContent || "";
      const reviews =
        item.querySelector(".AJB7ye .e4rVHe.fontBodyMedium .ZkP5Je .UY7F9")
          ?.textContent || "";
      const openPeriod =
        item.querySelector(
          "div.UaQhfb.fontBodyMedium > div:nth-child(4) > div:nth-child(2) > span:nth-child(1) > span > span:nth-child(2)"
        )?.textContent || "";
      const closePeriod =
        item.querySelector(
          "div.UaQhfb.fontBodyMedium > div:nth-child(4) > div:nth-child(2) > span:nth-child(1) > span > span:nth-child(1)"
        )?.textContent || "";
      const phoneNumber = item.querySelector(".UsdlK")?.textContent || "";
      let addresstest =
        item.querySelector(
          ".UaQhfb.fontBodyMedium .W4Efsd .W4Efsd span:nth-child(2) span:nth-child(2)"
        )?.textContent || "";
      const address = addresstest.split(",")[1] || "";
      const website =
        item.querySelector("a.lcr4fd.S9kvJb")?.getAttribute("href") || "";
      results.push({
        businessName,
        rating,
        reviews,
        openPeriod,
        closePeriod,
        phoneNumber,
        address,
        website,
      });
    });
    return results;
  });

  const uniqueData = [
    ...new Map(data.map((item) => [item.businessName, item])).values(),
  ];

  console.log(uniqueData);
  await browser.close();
  return uniqueData;
}

app.get("/scrape/:query", async (req, res) => {
  const data = await scrapeData({ query: req.params.query });
  res.json(data);
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
