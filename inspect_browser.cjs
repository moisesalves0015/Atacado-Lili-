const puppeteer = require("puppeteer-core");
const path = require("path");
const fs = require("fs");

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const ARTIFACT_DIR = "C:\\Users\\utente\\.gemini\\antigravity\\brain\\7614fba8-9418-4c34-a093-d88a6c3c7b5e";

async function run() {
  console.log("Launching Chrome...");
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"]
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    const logs = [];
    page.on("console", msg => logs.push(`[${msg.type()}] ${msg.text()}`));
    page.on("pageerror", err => logs.push(`[PAGE ERROR] ${err.message}`));

    console.log("Navigating to http://localhost:3001 ...");
    await page.goto("http://localhost:3001", { waitUntil: "networkidle2", timeout: 15000 });

    // Wait 2s for UI to settle
    await new Promise(r => setTimeout(r, 2000));

    // Screenshot 1: Vitrine Home
    const s1 = path.join(ARTIFACT_DIR, "vitrine-main-screen.png");
    await page.screenshot({ path: s1, fullPage: true });
    console.log("Screenshot 1 saved:", s1);

    // Check visible buttons on main screen
    const buttons = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("button")).map(b => ({
        text: b.innerText.trim(),
        className: b.className,
        title: b.title
      }));
    });
    console.log("Buttons found on Vitrine screen:", JSON.stringify(buttons, null, 2));

    // Look for "Mensagens e Cobrança" or "Ver Mensagens e Cobranças"
    const openBtn = await page.evaluateHandle(() => {
      const all = Array.from(document.querySelectorAll("button"));
      return all.find(b => b.innerText.includes("Mensagens e Cobrança") || b.innerText.includes("Ver Mensagens e Cobranças") || b.innerText.includes("Mensagens"));
    });

    if (openBtn) {
      console.log("Clicking messages button...");
      await openBtn.click();
      await new Promise(r => setTimeout(r, 1500));

      // Screenshot 2: Vitrine Messages Modal
      const s2 = path.join(ARTIFACT_DIR, "vitrine-messages-modal.png");
      await page.screenshot({ path: s2, fullPage: true });
      console.log("Screenshot 2 saved:", s2);

      // Check modal content
      const modalInfo = await page.evaluate(() => {
        const modal = document.querySelector(".vmc-modal, .modal-card, [role='dialog']");
        if (!modal) return "Modal not found";
        const preview = modal.querySelector(".vmc-message-preview, textarea, pre");
        const actionBtns = Array.from(modal.querySelectorAll(".vmc-action-btn, button")).map(b => b.innerText.trim());
        return {
          title: modal.querySelector("h2, h3")?.innerText,
          previewText: preview?.value || preview?.innerText,
          actionBtns
        };
      });
      console.log("Modal info:", JSON.stringify(modalInfo, null, 2));

      // Switch to "Cobrança de clientes" tab
      console.log("Switching to Cobrança tab...");
      const chargeTabBtn = await page.evaluateHandle(() => {
        const all = Array.from(document.querySelectorAll("button, .vmc-nav-tab"));
        return all.find(b => b.innerText.includes("Cobrança de clientes") || b.innerText.includes("Cobrar clientes"));
      });

      if (chargeTabBtn) {
        await chargeTabBtn.click();
        await new Promise(r => setTimeout(r, 1500));

        // Screenshot 3: Cobrança tab
        const s3 = path.join(ARTIFACT_DIR, "vitrine-cobranca-tab.png");
        await page.screenshot({ path: s3, fullPage: true });
        console.log("Screenshot 3 saved:", s3);

        const chargeCards = await page.evaluate(() => {
          const cards = Array.from(document.querySelectorAll(".vmc-charge-card, .mc-card"));
          return cards.map(c => ({
            client: c.querySelector("strong")?.innerText,
            buttons: Array.from(c.querySelectorAll("button")).map(b => b.innerText.trim()),
            preview: c.querySelector("textarea")?.value
          }));
        });
        console.log("Charge cards info:", JSON.stringify(chargeCards.slice(0, 3), null, 2));
      }
    }

    console.log("Console logs captured:", logs.slice(-15));
  } finally {
    await browser.close();
    console.log("Browser closed.");
  }
}

run().catch(err => {
  console.error("Browser inspection failed:", err);
  process.exit(1);
});
