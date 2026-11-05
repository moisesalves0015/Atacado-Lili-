import { describe, expect, it } from "vitest";
import {
  decodeQuotedPrintable,
  formatDeviceContacts,
  formatPhoneDisplay,
  normalizePhone,
  parseVcf,
  unfoldVcf,
} from "../shared/vcf";

describe("Normalização e formatação de telefones", () => {
  it("normaliza números com e sem DDI 55, DDD e formatações", () => {
    expect(normalizePhone("(65) 99999-0001")).toBe("5565999990001");
    expect(normalizePhone("+55 65 99999-0001")).toBe("5565999990001");
    expect(normalizePhone("5565999990001")).toBe("5565999990001");
    expect(normalizePhone("065 99999-0001")).toBe("5565999990001"); // zero à esquerda
    expect(normalizePhone("(11) 3333-4444")).toBe("551133334444"); // fixo com DDD
    expect(normalizePhone("+1 555 123 4567")).toBe("15551234567"); // internacional
    expect(normalizePhone("")).toBe("");
  });

  it("formata telefones para exibição legível", () => {
    expect(formatPhoneDisplay("5565999990001")).toBe("(65) 99999-0001");
    expect(formatPhoneDisplay("551133334444")).toBe("(11) 3333-4444");
    expect(formatPhoneDisplay("65999990001")).toBe("(65) 99999-0001");
  });
});

describe("VCF / vCard Parser", () => {
  it("desdobra linhas dobradas (folding de linhas longas RFC 2425/6350) e quebras suaves", () => {
    const folded = "FN:Nome Muito Longo e\r\n Sobrenome Composto\r\nTEL:65999\r\n 990001";
    const unfolded = unfoldVcf(folded);
    expect(unfolded).toContain("FN:Nome Muito Longo eSobrenome Composto");
    expect(unfolded).toContain("TEL:65999990001");
  });

  it("decodifica Quoted-Printable em UTF-8 e ISO-8859-1", () => {
    // Maria Conceição em QP UTF-8: =4D=61=72=69=61=20=43=6F=6E=63=65=69=C3=A7=C3=A3=6F
    const decodedUtf8 = decodeQuotedPrintable("=4D=61=72=69=61=20=43=6F=6E=63=65=69=C3=A7=C3=A3=6F", "utf-8");
    expect(decodedUtf8).toBe("Maria Conceição");

    // João em QP ISO-8859-1: =4A=6F=E3=6F
    const decodedIso = decodeQuotedPrintable("=4A=6F=E3=6F", "iso-8859-1");
    expect(decodedIso).toBe("João");
  });

  it("lê vCard 2.1 com Quoted-Printable e múltiplos telefones", () => {
    const vcf = `
BEGIN:VCARD
VERSION:2.1
N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Silva;Ana;Maria;;
FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Ana Maria Silva
TEL;HOME;VOICE:(65) 3666-1111
TEL;CELL;PREF:(65) 99999-2222
NOTE:Cliente VIP atacado
END:VCARD
    `.trim();

    const result = parseVcf(vcf);
    expect(result).toHaveLength(1);
    const contact = result[0];
    expect(contact.name).toBe("Ana Maria Silva");
    // CELULAR/PREF deve ser o telefone principal
    expect(contact.phone).toBe("(65) 99999-2222");
    expect(contact.phoneNormalized).toBe("5565999992222");
    expect(contact.phones).toHaveLength(2);
    expect(contact.hasValidPhone).toBe(true);
    expect(contact.hasValidName).toBe(true);
    expect(contact.notes).toBe("Cliente VIP atacado");
  });

  it("lê vCard 3.0 e 4.0 com caracteres escapados e nome estruturado (N)", () => {
    const vcf = `
BEGIN:VCARD
VERSION:3.0
N:Alves\\, Filha;Carla;;Dra.;
TEL;TYPE=cell:+55 65 98888-7777
END:VCARD

BEGIN:VCARD
VERSION:4.0
FN:Beatriz Oliveira\\, Loja 10
TEL;TYPE="voice,cell":65977776666
END:VCARD
    `.trim();

    const result = parseVcf(vcf);
    expect(result).toHaveLength(2);

    expect(result[0].name).toBe("Dra. Carla Alves, Filha");
    expect(result[0].phoneNormalized).toBe("5565988887777");

    expect(result[1].name).toBe("Beatriz Oliveira, Loja 10");
    expect(result[1].phoneNormalized).toBe("5565977776666");
  });

  it("trata contatos sem nome gerando fallback legível 'Cliente (XX) XXXXX-XXXX'", () => {
    const vcf = `
BEGIN:VCARD
VERSION:3.0
TEL;TYPE=CELL:(65) 99123-4567
END:VCARD
    `.trim();

    const result = parseVcf(vcf);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Cliente (65) 99123-4567");
    expect(result[0].hasValidName).toBe(false);
    expect(result[0].hasValidPhone).toBe(true);
    expect(result[0].phoneNormalized).toBe("5565991234567");
  });

  it("trata contatos sem telefone preservando o nome e marcando status 'no_phone'", () => {
    const vcf = `
BEGIN:VCARD
VERSION:3.0
FN:Boutique Elegance
NOTE:Contato via direct do Instagram
END:VCARD
    `.trim();

    const result = parseVcf(vcf);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Boutique Elegance");
    expect(result[0].hasValidName).toBe(true);
    expect(result[0].hasValidPhone).toBe(false);
    expect(result[0].status).toBe("no_phone");
    expect(result[0].phone).toBe("");
  });

  it("descarta cartões vazios sem nome e sem telefone", () => {
    const vcf = `
BEGIN:VCARD
VERSION:3.0
X-NOTE:Cartão corrompido sem dados
END:VCARD
    `.trim();

    const result = parseVcf(vcf);
    expect(result).toHaveLength(0);
  });
});

describe("Formatador de contatos do aparelho (Contact Picker API)", () => {
  it("converte o formato retornado pelo navigator.contacts.select", () => {
    const deviceContacts = [
      { name: ["Fernanda Lima"], tel: ["(65) 99654-3210", "+55 65 3000-1000"] },
      { name: [""], tel: ["65981112233"] },
      { name: ["Apenas Nome"], tel: [] },
    ];

    const formatted = formatDeviceContacts(deviceContacts);
    expect(formatted).toHaveLength(3);

    expect(formatted[0].name).toBe("Fernanda Lima");
    expect(formatted[0].phone).toBe("(65) 99654-3210");
    expect(formatted[0].phones).toHaveLength(2);
    expect(formatted[0].phoneNormalized).toBe("5565996543210");
    expect(formatted[0].source).toBe("device_contact");

    expect(formatted[1].name).toBe("Cliente (65) 98111-2233");
    expect(formatted[1].hasValidName).toBe(false);
    expect(formatted[1].hasValidPhone).toBe(true);

    expect(formatted[2].name).toBe("Apenas Nome");
    expect(formatted[2].hasValidPhone).toBe(false);
    expect(formatted[2].status).toBe("no_phone");
  });
});

