import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, importClients, listClients } from "./db";
import { getStore } from "./firebaseStore";
import { appRouter } from "./routers";

function randomPhone(prefix = "99") {
  const rand = Math.floor(100000 + Math.random() * 900000);
  return `(65) ${prefix}${rand.toString().slice(0, 7)}`;
}

describe("Importação e desduplicação de clientes", () => {
  let initialClientsCount = 0;

  beforeEach(() => {
    const store = getStore();
    initialClientsCount = store.clients.length;
  });

  afterEach(() => {
    const store = getStore();
    if (store.clients.length > initialClientsCount) {
      store.clients = store.clients.slice(0, initialClientsCount);
    }
  });

  it("desduplica contatos pelo telefone normalizado (com DDI e DDD variantes)", async () => {
    const testActorId = 999;
    const basePhone = randomPhone("91");
    const digitsOnly = basePhone.replace(/\D/g, ""); // ex: 6591123456
    const with55 = `+55 ${basePhone}`;
    const uniqueClientName = `Cliente Simulado ${Date.now()}`;

    // 1. Cria cliente inicial com telefone formatado
    const client1 = await createClient(testActorId, {
      name: uniqueClientName,
      phone: basePhone,
    });
    expect(client1.id).toBeDefined();

    const otherPhone = randomPhone("92");

    // 2. Tenta importar em lote com variação de formato (+55)
    const result = await importClients(
      testActorId,
      [
        { name: `${uniqueClientName} Repetida`, phone: with55 }, // duplicado
        { name: `${uniqueClientName} Outro Formato`, phone: `55${digitsOnly}` }, // duplicado
        { name: "Cliente Nova 1", phone: otherPhone }, // novo
      ],
      "vcf_import"
    );

    expect(result.imported).toBe(1);
    expect(result.duplicates).toBe(2);
    expect(result.invalid).toBe(0);

    const listed = await listClients(uniqueClientName);
    expect(listed.filter(c => c.name === uniqueClientName)).toHaveLength(1);
  });

  it("desduplica itens repetidos dentro do mesmo lote", async () => {
    const testActorId = 999;
    const phone1 = randomPhone("93");
    const result = await importClients(
      testActorId,
      [
        { name: "Irmãs Confecções", phone: phone1 },
        { name: "Irmãs Confecções 2", phone: `+55 ${phone1}` }, // duplicata intra-lote
      ],
      "device_contact"
    );

    expect(result.imported).toBe(1);
    expect(result.duplicates).toBe(1);
  });

  it("aceita contatos sem telefone ou sem nome conforme os critérios de fallback", async () => {
    const testActorId = 999;
    const uniqueName = `Boutique Exclusiva ${Date.now()}`;
    const uniquePhone = randomPhone("94");

    const result = await importClients(
      testActorId,
      [
        { name: uniqueName, phone: "" }, // sem telefone -> deve aceitar
        { name: "", phone: uniquePhone }, // sem nome -> Cliente (XX) XXXXX-XXXX
        { name: "", phone: "" }, // sem nenhum dos dois -> inválido
      ],
      "vcf_import"
    );

    expect(result.imported).toBe(2);
    expect(result.invalid).toBe(1);

    const noPhoneClient = (await listClients(uniqueName))[0];
    expect(noPhoneClient).toBeDefined();
    expect(noPhoneClient?.phone).toBe("");

    const noNameClient = (await listClients(uniquePhone))[0];
    expect(noNameClient).toBeDefined();
    expect(noNameClient?.phone).toBe(uniquePhone);
  });

  it("garante privacidade total nos logs de auditoria (NENHUM nome ou telefone nos metadados)", async () => {
    const store = getStore();
    const testActorId = 777;

    const testCustomerName = `Cliente Teste Privacidade ${Date.now()}`;
    const testCustomerPhone = randomPhone("95");

    await createClient(testActorId, {
      name: testCustomerName,
      phone: testCustomerPhone,
    });

    const otherTestPhone = randomPhone("96");
    await importClients(
      testActorId,
      [{ name: testCustomerName + " 2", phone: otherTestPhone }],
      "device_contact"
    );

    // Inspeciona os registros de auditoria mais recentes
    const recentAudits = store.auditLogs.slice(0, 10);
    for (const entry of recentAudits) {
      if (entry.metadata) {
        // NENHUM nome ou telefone de cliente deve estar contido nos logs de auditoria
        expect(entry.metadata).not.toContain(testCustomerName);
        expect(entry.metadata).not.toContain(testCustomerPhone);
        expect(entry.metadata).not.toContain(otherTestPhone);
      }
    }
  });
});

describe("Autenticação e segurança do endpoint de importação", () => {
  it("exige sessão administrativa autenticada para invocar clients.importBatch e importVcf", async () => {
    const unauthedCaller = appRouter.createCaller({
      user: null as any,
      req: { protocol: "https", headers: {} } as any,
      res: { cookie: vi.fn(), clearCookie: vi.fn() } as any,
    });

    await expect(
      unauthedCaller.clients.importBatch({
        contacts: [{ name: "Teste", phone: "65999990001" }],
      })
    ).rejects.toThrow(/UNAUTHORIZED|Não autorizado|permission/i);

    await expect(
      unauthedCaller.clients.importVcf({
        contacts: [{ name: "Teste", phone: "65999990001" }],
      })
    ).rejects.toThrow(/UNAUTHORIZED|Não autorizado|permission/i);
  });

  it("rejeita senhas fracas padrão em ambiente de produção", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ADMIN_PASSWORD", "SuperSecureProductionPassword2026!");

    const caller = appRouter.createCaller({
      user: null as any,
      req: { protocol: "https", headers: {} } as any,
      res: { cookie: vi.fn(), clearCookie: vi.fn() } as any,
    });

    // Tentativas com senhas fracas comuns
    for (const weak of ["1234", "admin", "admin123", "password"]) {
      await expect(
        caller.auth.login({ username: "admin", password: weak })
      ).rejects.toThrow(/Usuário ou senha incorretos/i);
    }

    // Com a senha de produção correta, obtém sucesso
    const success = await caller.auth.login({
      username: "admin",
      password: "SuperSecureProductionPassword2026!",
    });
    expect(success.success).toBe(true);

    vi.unstubAllEnvs();
  });
});
