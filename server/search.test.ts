import { describe, expect, it } from "vitest";
import { matchClient, normalizeSearch } from "../shared/search";

describe("Busca flexível de clientes (matchClient)", () => {
  it("encontra cliente sem acentuação mesmo que o cadastro tenha acento", () => {
    const client = { name: "Débora Biagiolli", phone: "16997571303" };
    expect(matchClient(client, "debora")).toBe(true);
    expect(matchClient(client, "DEBORA")).toBe(true);
    expect(matchClient(client, "biagiolli")).toBe(true);
    expect(matchClient(client, "biagioli")).toBe(true); // erro de 1 letra (l vs ll)
  });

  it("encontra cliente com palavras fora de ordem", () => {
    const client = { name: "Maria Aparecida Silva", phone: "65999990001" };
    expect(matchClient(client, "silva maria")).toBe(true);
    expect(matchClient(client, "aparecida silva")).toBe(true);
  });

  it("encontra cliente por escrita parecida (levenshtein)", () => {
    const client = { name: "Michele Alcântara Cardápios", phone: "21981321690" };
    expect(matchClient(client, "michelli")).toBe(true);
    expect(matchClient(client, "alcantara cardapios")).toBe(true);
    expect(matchClient(client, "cardapio")).toBe(true);
  });

  it("encontra cliente por dígitos de telefone", () => {
    const client = { name: "Renato Linhares", phone: "+55 21 99553-9246" };
    expect(matchClient(client, "99553")).toBe(true);
    expect(matchClient(client, "2199553")).toBe(true);
  });

  it("não encontra quando a busca não tem relação", () => {
    const client = { name: "Renato Linhares", phone: "+55 21 99553-9246" };
    expect(matchClient(client, "Fernanda")).toBe(false);
    expect(matchClient(client, "9999999")).toBe(false);
  });
});

