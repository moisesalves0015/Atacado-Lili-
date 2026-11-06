import { describe, expect, it } from "vitest";
import { matchClient } from "../shared/search";

describe("Busca de clientes com indiferença a sinais e acentos (matchClient)", () => {
  it("encontra cliente sem acentuação mesmo que o cadastro tenha acento ou cedilha", () => {
    const client1 = { name: "Débora Biagiolli", phone: "16997571303" };
    expect(matchClient(client1, "debora")).toBe(true);
    expect(matchClient(client1, "DEBORA")).toBe(true);
    expect(matchClient(client1, "Débora")).toBe(true);
    expect(matchClient(client1, "biagiolli")).toBe(true);

    const client2 = { name: "Maria Gonçalves Conceição", phone: "65999990001" };
    expect(matchClient(client2, "goncalves")).toBe(true);
    expect(matchClient(client2, "conceicao")).toBe(true);
    expect(matchClient(client2, "GONCALVES")).toBe(true);
  });

  it("encontra cliente com palavras fora de ordem", () => {
    const client = { name: "Maria Aparecida Silva", phone: "65999990001" };
    expect(matchClient(client, "silva maria")).toBe(true);
    expect(matchClient(client, "aparecida silva")).toBe(true);
    expect(matchClient(client, "maria silva")).toBe(true);
  });

  it("exige que a escrita seja correspondente (não traz nomes parecidos com letras trocadas)", () => {
    const client = { name: "Michele Alcântara Cardápios", phone: "21981321690" };
    // "michele" corresponde
    expect(matchClient(client, "michele")).toBe(true);
    expect(matchClient(client, "alcantara")).toBe(true);
    expect(matchClient(client, "cardapio")).toBe(true);

    // "michelli" (com ll e i no final) NÃO deve bater com Michele
    expect(matchClient(client, "michelli")).toBe(false);
    // "debora" NÃO deve bater com Michele
    expect(matchClient(client, "debora")).toBe(false);
  });

  it("não traz clientes quando a escrita não bate (evita falsos positivos em listas grandes)", () => {
    const client = { name: "Ana Beatriz", phone: "11999998888" };
    // "ana" bate
    expect(matchClient(client, "ana")).toBe(true);
    // "ano", "ant", "ada" não devem bater com "Ana"
    expect(matchClient(client, "ano")).toBe(false);
    expect(matchClient(client, "ant")).toBe(false);
    expect(matchClient(client, "ada")).toBe(false);
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
