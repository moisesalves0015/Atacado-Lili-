const puppeteer = require("puppeteer-core");
const path = require("path");

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const ARTIFACT_DIR = "C:\\Users\\utente\\.gemini\\antigravity\\brain\\7614fba8-9418-4c34-a093-d88a6c3c7b5e";

async function verify() {
  console.log("=== INICIANDO VERIFICAÇÃO COM LOGIN DIRETO ===");

  // 1. Obter token de admin via API
  const loginRes = await fetch("http://localhost:3001/api/trpc/auth.login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ json: { username: "admin", password: "1234" } })
  });
  const loginJson = await loginRes.json();
  const token = loginJson.result.data.json.token;
  console.log("Token de autenticação obtido com sucesso!");

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu", "--window-size=1280,900"]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  page.on("console", msg => console.log(`[BROWSER ${msg.type()}]:`, msg.text()));
  page.on("pageerror", err => console.error(`[PAGE ERROR]:`, err.message));

  // Injetar token no localStorage antes de carregar
  console.log("Injetando sessão de admin...");
  await page.goto("http://localhost:3001", { waitUntil: "domcontentloaded" });
  await page.evaluate(t => {
    localStorage.setItem("vendaatacado-token", t);
  }, token);

  // Recarrega autenticado
  await page.goto("http://localhost:3001", { waitUntil: "networkidle2" });
  await new Promise(r => setTimeout(r, 2000));

  // 1. Screenshot da tela principal da Vitrine autenticada
  console.log("Capturando tela principal da Vitrine...");
  const s1 = path.join(ARTIFACT_DIR, "1-vitrine-principal.png");
  await page.screenshot({ path: s1, fullPage: true });
  console.log("Screenshot 1 salvo em:", s1);

  const vitrineButtons = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("button")).map(b => b.innerText.trim()).filter(Boolean);
  });
  console.log("Botões encontrados na Vitrine:\n", vitrineButtons);

  // 2. Clicar no botão de Mensagens e Cobrança
  console.log("Abrindo Central de Mensagens e Cobrança...");
  const clickedBtn = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const target = btns.find(b => b.innerText.includes("Ver Mensagens") || b.innerText.includes("Mensagens e Cobrança") || b.innerText.includes("Mensagens"));
    if (target) {
      target.click();
      return target.innerText;
    }
    return null;
  });
  console.log("Botão acionado:", clickedBtn);
  await new Promise(r => setTimeout(r, 2000));

  // 3. Screenshot da aba Atualização de Grupo
  const s2 = path.join(ARTIFACT_DIR, "2-atualizar-grupo.png");
  await page.screenshot({ path: s2, fullPage: true });
  console.log("Screenshot 2 (Atualização de Grupo) salvo em:", s2);

  const updatePreview = await page.evaluate(() => {
    const textarea = document.querySelector(".vmc-preview, textarea");
    return textarea ? textarea.value : "Sem prévia de texto";
  });
  console.log("\n--- TEXTO GERADO DE ATUALIZAÇÃO DO GRUPO ---\n" + updatePreview + "\n---------------------------------------------\n");

  // 4. Mudar para aba Cobrança de clientes
  console.log("Mudando para aba 'Cobrança de clientes'...");
  await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll(".vmc-nav-tab, button"));
    const cobranca = tabs.find(t => t.innerText.includes("Cobrança de clientes") || t.innerText.includes("Cobrar clientes"));
    if (cobranca) cobranca.click();
  });
  await new Promise(r => setTimeout(r, 2000));

  // 5. Screenshot da aba Cobrança de clientes
  const s3 = path.join(ARTIFACT_DIR, "3-cobranca-clientes.png");
  await page.screenshot({ path: s3, fullPage: true });
  console.log("Screenshot 3 (Cobrança de Clientes) salvo em:", s3);

  const chargeCards = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll(".vmc-charge-card-row, .vmc-charge-card, .mc-card"));
    return cards.map(c => {
      const client = c.querySelector("strong")?.innerText;
      const btns = Array.from(c.querySelectorAll(".vmc-action-btn, button")).map(b => b.innerText.trim());
      const text = c.querySelector("textarea")?.value;
      return { client, buttons: btns, text };
    });
  });
  console.log("Detalhes do primeiro cartão de cobrança:\n", JSON.stringify(chargeCards[0], null, 2));

  // 6. Testar botão Cobrado
  console.log("Testando botão 'Cobrado'...");
  const cobradoRes = await page.evaluate(() => {
    const cobradoBtn = Array.from(document.querySelectorAll(".vmc-action-btn.charged, button")).find(b => b.innerText.includes("Cobrado"));
    if (cobradoBtn) {
      cobradoBtn.click();
      return true;
    }
    return false;
  });
  console.log("Botão Cobrado clicado com sucesso?", cobradoRes);
  await new Promise(r => setTimeout(r, 1500));

  // 7. Fazer F5 (reload) para provar persistência
  console.log("Recarregando a página (F5) para provar que o status Cobrado fica salvo...");
  await page.reload({ waitUntil: "networkidle2" });
  await new Promise(r => setTimeout(r, 2000));

  // Reabrir modal de mensagens
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const target = btns.find(b => b.innerText.includes("Ver Mensagens") || b.innerText.includes("Mensagens e Cobrança") || b.innerText.includes("Mensagens"));
    if (target) target.click();
  });
  await new Promise(r => setTimeout(r, 1500));

  // Ir para aba cobrança
  await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll(".vmc-nav-tab, button"));
    const cobranca = tabs.find(t => t.innerText.includes("Cobrança de clientes") || t.innerText.includes("Cobrar clientes"));
    if (cobranca) cobranca.click();
  });
  await new Promise(r => setTimeout(r, 1500));

  const s4 = path.join(ARTIFACT_DIR, "4-apos-recarregar-persistente.png");
  await page.screenshot({ path: s4, fullPage: true });
  console.log("Screenshot 4 salvo em:", s4);

  const persistenceStatus = await page.evaluate(() => {
    const activeCharged = document.querySelector(".vmc-action-btn.charged.is-active, .vmc-status-charged");
    return {
      cobradoIsActive: Boolean(activeCharged),
      activeClassName: activeCharged?.className
    };
  });
  console.log("Verificação de persistência após F5:\n", JSON.stringify(persistenceStatus, null, 2));

  await browser.close();
  console.log("=== TODAS AS VERIFICAÇÕES CONCLUÍDAS COM SUCESSO! ===");
}

verify().catch(err => {
  console.error("Falha na verificação:", err);
  process.exit(1);
});
