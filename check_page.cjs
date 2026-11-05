const puppeteer = require("puppeteer-core");
const path = require("path");

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const ARTIFACT_DIR = "C:\\Users\\utente\\.gemini\\antigravity\\brain\\7614fba8-9418-4c34-a093-d88a6c3c7b5e";

async function run() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  page.on("console", msg => console.log(`[BROWSER CONSOLE] ${msg.type()}: ${msg.text()}`));
  page.on("pageerror", err => console.log(`[PAGE ERROR]: ${err.message}`));

  await page.goto("http://localhost:3001", { waitUntil: "networkidle2" });
  await new Promise(r => setTimeout(r, 2000));

  const url = page.url();
  console.log("Current page URL:", url);

  const title = await page.title();
  console.log("Page title:", title);

  const bodyText = await page.evaluate(() => document.body.innerText);
  console.log("Body text preview:\n", bodyText.slice(0, 500));

  const rootHtml = await page.evaluate(() => document.getElementById("root")?.innerHTML?.slice(0, 500));
  console.log("Root element HTML preview:\n", rootHtml);

  await browser.close();
}

run().catch(console.error);
