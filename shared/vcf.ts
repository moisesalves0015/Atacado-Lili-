/**
 * Utilitários compartilhados para manipulação de contatos, vCard (VCF)
 * e integração com agenda/dispositivo para o Atacado Lili.
 */

export interface ContactPhone {
  number: string;
  type?: string;
  isPreferred?: boolean;
}

export interface ParsedContact {
  id?: string;
  name: string;
  rawName: string;
  phone: string; // telefone principal selecionado para importação
  phones: string[]; // todos os telefones encontrados neste contato
  phoneNormalized: string;
  notes?: string;
  hasValidPhone: boolean;
  hasValidName: boolean;
  status: "valid" | "duplicate" | "no_phone" | "no_name" | "invalid";
  reason?: string;
  source?: "vcf_import" | "device_contact" | "manual";
}

/**
 * Normaliza um telefone para comparação e busca única.
 * Formato canônico brasileiro: 55 + DDD (2 dígitos) + 8 ou 9 dígitos.
 * Preserva números internacionais e lida com zeros à esquerda e pontuações.
 */
export function normalizePhone(phone: string): string {
  if (!phone) return "";
  const trimmed = phone.trim();
  const hasPlus = trimmed.startsWith("+");
  let digits = trimmed.replace(/\D/g, "");
  // Remove zero à esquerda de DDDs (ex: 065999990001 -> 65999990001)
  digits = digits.replace(/^0+/, "");

  if (!digits) return "";

  // Se começou com + e não é +55, é outro país: preserva os dígitos
  if (hasPlus && !trimmed.startsWith("+55")) {
    return digits;
  }

  // Já possui DDI 55 com 12 ou 13 dígitos
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    return digits;
  }

  // Celular (11 dígitos) ou fixo (10 dígitos) no Brasil -> adiciona 55
  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }

  return digits;
}

/**
 * Formata um número normalizado para exibição amigável.
 */
export function formatPhoneDisplay(phone: string): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");

  // Formato brasileiro padrão com 55 (13 dígitos: 55 + DDD + 9 dígitos)
  if (digits.startsWith("55") && digits.length === 13) {
    const ddd = digits.slice(2, 4);
    const part1 = digits.slice(4, 9);
    const part2 = digits.slice(9);
    return `(${ddd}) ${part1}-${part2}`;
  }

  // Formato brasileiro fixo com 55 (12 dígitos: 55 + DDD + 8 dígitos)
  if (digits.startsWith("55") && digits.length === 12) {
    const ddd = digits.slice(2, 4);
    const part1 = digits.slice(4, 8);
    const part2 = digits.slice(8);
    return `(${ddd}) ${part1}-${part2}`;
  }

  // 11 dígitos sem 55 (DDD + 9 dígitos)
  if (digits.length === 11) {
    const ddd = digits.slice(0, 2);
    const part1 = digits.slice(2, 7);
    const part2 = digits.slice(7);
    return `(${ddd}) ${part1}-${part2}`;
  }

  // 10 dígitos sem 55 (DDD + 8 dígitos)
  if (digits.length === 10) {
    const ddd = digits.slice(0, 2);
    const part1 = digits.slice(2, 6);
    const part2 = digits.slice(6);
    return `(${ddd}) ${part1}-${part2}`;
  }

  return phone.trim();
}

/**
 * Desfaz quebras de linha de continuação (folding) de acordo com RFC 2425 e RFC 6350.
 * Também lida com quebras suaves de quoted-printable (= no final da linha).
 */
export function unfoldVcf(raw: string): string {
  // 1. Quebras suaves Quoted-Printable (=\r?\n)
  let text = raw.replace(/=\r?\n/g, "");
  // 2. Linhas dobradas vCard (iniciando com espaço ou tab após quebra de linha)
  text = text.replace(/\r?\n[ \t]/g, "");
  return text;
}

/**
 * Decodifica conteúdo codificado em Quoted-Printable.
 */
export function decodeQuotedPrintable(input: string, charset = "utf-8"): string {
  const bytes: number[] = [];
  let i = 0;
  while (i < input.length) {
    if (input[i] === "=" && i + 2 < input.length && /^[0-9A-Fa-f]{2}$/.test(input.slice(i + 1, i + 3))) {
      bytes.push(parseInt(input.slice(i + 1, i + 3), 16));
      i += 3;
    } else {
      const code = input.charCodeAt(i);
      if (code < 128) {
        bytes.push(code);
      } else {
        const encoded = new TextEncoder().encode(input[i]);
        for (const b of encoded) bytes.push(b);
      }
      i++;
    }
  }

  const encoding = charset.toLowerCase().includes("iso-8859-1") || charset.toLowerCase().includes("latin1")
    ? "iso-8859-1"
    : "utf-8";

  try {
    return new TextDecoder(encoding).decode(new Uint8Array(bytes));
  } catch {
    return new TextDecoder("utf-8").decode(new Uint8Array(bytes));
  }
}

/**
 * Desfaz caracteres escapados padrão de vCard (\,, \;, \\, \n).
 */
export function unescapeVCardValue(value: string): string {
  return value
    .replace(/\\n/gi, " ")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

/**
 * Decodifica o valor de um campo levando em conta CHARSET e ENCODING nos parâmetros.
 */
function parseVCardFieldValue(params: string, rawValue: string): string {
  let val = rawValue.trim();
  const isQp = /ENCODING=(?:QUOTED-PRINTABLE|B)/i.test(params) || /;QP[;:]/i.test(params);
  const charsetMatch = params.match(/CHARSET=([^;:]+)/i);
  const charset = charsetMatch ? charsetMatch[1].trim() : "utf-8";

  if (isQp) {
    val = decodeQuotedPrintable(val, charset);
  }

  return unescapeVCardValue(val);
}

/**
 * Extrai o nome estruturado de um campo N (N:Sobrenome;Nome;NomeDoMeio;Prefixo;Sufixo).
 */
function parseStructuredName(params: string, rawValue: string): string {
  const isQp = /ENCODING=(?:QUOTED-PRINTABLE|B)/i.test(params);
  const charsetMatch = params.match(/CHARSET=([^;:]+)/i);
  const charset = charsetMatch ? charsetMatch[1].trim() : "utf-8";

  const parts = rawValue.split(";").map(part => {
    let p = part.trim();
    if (isQp) p = decodeQuotedPrintable(p, charset);
    return unescapeVCardValue(p);
  });

  const [family, given, middle, prefix, suffix] = parts;
  const ordered = [prefix, given, middle, family, suffix].filter(Boolean);
  return ordered.join(" ").trim();
}

/**
 * Faz o parsing completo de um arquivo VCF/vCard com suporte a:
 * - vCard 2.1, 3.0, 4.0
 * - Unfolding de linhas longas
 * - Quoted-Printable e Charsets (UTF-8, ISO-8859-1)
 * - Múltiplos telefones com priorização de celular (CELL/PREF)
 * - Nomes não informados geram fallback "Cliente (XX) XXXXX-XXXX"
 * - Contatos sem telefone são mantidos com indicação clara
 */
export function parseVcf(rawContent: string): ParsedContact[] {
  if (!rawContent || !rawContent.trim()) return [];

  const unfolded = unfoldVcf(rawContent);
  const cards = unfolded.split(/BEGIN:VCARD/i).slice(1);
  const results: ParsedContact[] = [];

  for (const block of cards) {
    const lines = block.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    let fn = "";
    let n = "";
    const phoneCandidates: Array<{ number: string; priority: number }> = [];
    let notes = "";

    for (const line of lines) {
      if (/^END:VCARD/i.test(line)) break;

      // Localiza a divisão entre tag/parâmetros e o valor
      const colonIndex = line.indexOf(":");
      if (colonIndex === -1) continue;

      const header = line.slice(0, colonIndex);
      const value = line.slice(colonIndex + 1);
      const semicolonIndex = header.indexOf(";");
      const tag = (semicolonIndex === -1 ? header : header.slice(0, semicolonIndex)).toUpperCase().trim();
      const params = semicolonIndex === -1 ? "" : header.slice(semicolonIndex + 1);

      if (tag === "FN") {
        const parsed = parseVCardFieldValue(params, value);
        if (parsed) fn = parsed;
      } else if (tag === "N") {
        const parsed = parseStructuredName(params, value);
        if (parsed) n = parsed;
      } else if (tag === "TEL") {
        const rawPhone = parseVCardFieldValue(params, value);
        const cleanDigits = rawPhone.replace(/\D/g, "");
        if (cleanDigits.length >= 6) {
          // Prioridade: PREF ou CELL têm maior prioridade
          let priority = 10;
          if (/PREF/i.test(params)) priority += 20;
          if (/CELL|MOBILE/i.test(params)) priority += 10;
          if (/HOME/i.test(params)) priority += 2;
          if (/WORK/i.test(params)) priority += 1;

          phoneCandidates.push({ number: rawPhone, priority });
        }
      } else if (tag === "NOTE") {
        const parsed = parseVCardFieldValue(params, value);
        if (parsed) notes = notes ? `${notes}\n${parsed}` : parsed;
      }
    }

    // Ordena telefones por prioridade decrescente e remove duplicatas dentro do mesmo cartão
    phoneCandidates.sort((a, b) => b.priority - a.priority);
    const uniquePhones: string[] = [];
    const seenPhones = new Set<string>();

    for (const cand of phoneCandidates) {
      const norm = normalizePhone(cand.number);
      if (!seenPhones.has(norm)) {
        seenPhones.add(norm);
        uniquePhones.push(cand.number);
      }
    }

    const primaryPhone = uniquePhones[0] || "";
    const hasValidPhone = primaryPhone.replace(/\D/g, "").length >= 8;
    const resolvedRawName = fn || n || "";
    const hasValidName = Boolean(resolvedRawName.trim());

    // Se não tiver nome mas tiver telefone: gera nome legível temporário
    const resolvedName = hasValidName
      ? resolvedRawName.trim()
      : hasValidPhone
      ? `Cliente ${formatPhoneDisplay(primaryPhone)}`
      : "";

    // Se não tiver nem nome nem telefone válido, descarta
    if (!hasValidName && !hasValidPhone) {
      continue;
    }

    let status: ParsedContact["status"] = "valid";
    let reason: string | undefined;

    if (!hasValidPhone) {
      status = "no_phone";
      reason = "Sem telefone cadastrado";
    }

    results.push({
      id: `vcf-${results.length + 1}-${Date.now().toString(36)}`,
      name: resolvedName,
      rawName: resolvedRawName,
      phone: primaryPhone,
      phones: uniquePhones,
      phoneNormalized: hasValidPhone ? normalizePhone(primaryPhone) : "",
      notes: notes || undefined,
      hasValidPhone,
      hasValidName,
      status,
      reason,
      source: "vcf_import",
    });
  }

  return results;
}

/**
 * Converte contatos selecionados via Web Contact Picker API para o formato unificado.
 */
export function formatDeviceContacts(
  rawContacts: Array<{ name?: string[]; tel?: string[] }>
): ParsedContact[] {
  const results: ParsedContact[] = [];

  for (let i = 0; i < rawContacts.length; i++) {
    const item = rawContacts[i];
    const rawName = (item.name?.[0] || "").trim();
    const phones = (item.tel || []).map(p => p.trim()).filter(Boolean);

    // Remove duplicatas
    const uniquePhones: string[] = [];
    const seen = new Set<string>();
    for (const p of phones) {
      const norm = normalizePhone(p);
      if (!seen.has(norm)) {
        seen.add(norm);
        uniquePhones.push(p);
      }
    }

    const primaryPhone = uniquePhones[0] || "";
    const hasValidPhone = primaryPhone.replace(/\D/g, "").length >= 8;
    const hasValidName = Boolean(rawName);

    if (!hasValidName && !hasValidPhone) {
      continue;
    }

    const resolvedName = hasValidName
      ? rawName
      : `Cliente ${formatPhoneDisplay(primaryPhone)}`;

    let status: ParsedContact["status"] = "valid";
    let reason: string | undefined;

    if (!hasValidPhone) {
      status = "no_phone";
      reason = "Sem telefone informado";
    }

    results.push({
      id: `dev-${i + 1}-${Date.now().toString(36)}`,
      name: resolvedName,
      rawName,
      phone: primaryPhone,
      phones: uniquePhones,
      phoneNormalized: hasValidPhone ? normalizePhone(primaryPhone) : "",
      hasValidPhone,
      hasValidName,
      status,
      reason,
      source: "device_contact",
    });
  }

  return results;
}
