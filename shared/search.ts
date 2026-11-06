/**
 * Utilitários para busca tolerante a acentuação e pequenos erros de digitação (fuzzy matching)
 * Usado tanto no backend (listClients) quanto no frontend (busca na vitrine e carteira).
 */

export function normalizeSearch(text?: string | null): string {
  if (!text) return "";
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  // Otimização de espaço com dois vetores
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);

  for (let j = 0; j <= n; j++) {
    prev[j] = j;
  }

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    const aChar = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = aChar === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1, // inserção
        prev[j] + 1, // deleção
        prev[j - 1] + cost // substituição
      );
    }
    const temp = prev;
    prev = curr;
    curr = temp;
  }

  return prev[n];
}

/**
 * Verifica se um contato dá match com a busca fornecida.
 * Suporta:
 * 1. Sem acentuação (débora == debora)
 * 2. Case insensitive (MAIÚSCULAS/minúsculas)
 * 3. Busca por partes do telefone (dígitos)
 * 4. Palavras fora de ordem ("silva maria" acha "Maria Aparecida Silva")
 * 5. Escrita parecida / pequenos erros de digitação (1 a 2 letras diferentes)
 */
export function matchClient(
  client: { name?: string | null; phone?: string | null; notes?: string | null },
  rawQuery?: string | null
): boolean {
  if (!rawQuery) return true;
  const query = normalizeSearch(rawQuery);
  if (!query) return true;

  const rawPhone = client.phone || "";
  const phoneDigits = rawPhone.replace(/\D/g, "");
  const queryDigits = query.replace(/\D/g, "");

  // 1. Match por telefone se o usuário digitou dígitos
  if (queryDigits.length >= 3 && phoneDigits.includes(queryDigits)) {
    return true;
  }

  const name = normalizeSearch(client.name);
  if (!name) return false;

  // 2. Match exato ou substring direto do nome
  if (name.includes(query)) {
    return true;
  }

  // 3. Match nas observações (se houver)
  if (client.notes) {
    const notes = normalizeSearch(client.notes);
    if (notes.includes(query)) return true;
  }

  // 4. Match por palavras / tokens (permite palavras fora de ordem e pequenos erros)
  const queryTokens = query.split(/[\s,;.-]+/).filter(Boolean);
  const nameTokens = name.split(/[\s,;.-]+/).filter(Boolean);

  if (queryTokens.length === 0) return true;

  // Todos os termos buscados precisam casar com alguma parte do nome
  const allTokensMatch = queryTokens.every(qTok => {
    // Substring em qualquer palavra do nome
    for (const nTok of nameTokens) {
      if (nTok.includes(qTok) || qTok.includes(nTok)) {
        return true;
      }
      // Se a palavra tiver pelo menos 3 caracteres, tolera pequenos erros
      if (qTok.length >= 3 && nTok.length >= 3) {
        const maxDist = qTok.length >= 6 ? 2 : 1;
        if (levenshteinDistance(qTok, nTok) <= maxDist) {
          return true;
        }
      }
    }
    return false;
  });

  return allTokensMatch;
}

