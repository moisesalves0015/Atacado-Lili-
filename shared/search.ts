/**
 * Utilitários para busca de clientes com indiferença a acentos, sinais e maiúsculas/minúsculas.
 * A escrita precisa ser correspondente (sem aproximação/fuzzy com letras trocadas).
 */

export function normalizeSearch(text?: string | null): string {
  if (!text) return "";
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Distância de Levenshtein (mantida como utilitário geral).
 */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

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
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost
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
 * Regras:
 * 1. Indiferente a sinais e acentuação (débora == debora, gonçalves == goncalves, joão == joao)
 * 2. Indiferente a maiúsculas/minúsculas
 * 3. Escrita correspondente: as letras digitadas devem bater exatamente como substring no nome/observações
 * 4. Palavras compostas: se digitar mais de uma palavra ("silva maria"), todas precisam estar presentes
 * 5. Dígitos de telefone: pesquisa direta no telefone caso fornecido
 */
export function matchClient(
  client: { name?: string | null; phone?: string | null; notes?: string | null },
  rawQuery?: string | null
): boolean {
  if (!rawQuery) return true;
  const trimmed = rawQuery.trim();
  if (!trimmed) return true;

  const query = normalizeSearch(trimmed);
  if (!query) return true;

  const rawPhone = client.phone || "";
  const phoneDigits = rawPhone.replace(/\D/g, "");
  const queryDigits = trimmed.replace(/\D/g, "");

  // 1. Match por telefone se o usuário digitou ao menos 3 dígitos
  if (queryDigits.length >= 3 && phoneDigits.includes(queryDigits)) {
    return true;
  }

  const name = normalizeSearch(client.name);
  const notes = client.notes ? normalizeSearch(client.notes) : "";

  // 2. Match direto de substring no nome ou notas
  if (name.includes(query) || (notes && notes.includes(query))) {
    return true;
  }

  // 3. Match com palavras fora de ordem ("silva maria" acha "Maria Aparecida Silva")
  const queryTokens = query.split(/[\s,;.-]+/).filter(Boolean);
  if (queryTokens.length > 1) {
    const allTokensMatch = queryTokens.every(qTok => {
      if (/^\d+$/.test(qTok) && phoneDigits.includes(qTok)) {
        return true;
      }
      return name.includes(qTok) || (notes && notes.includes(qTok));
    });
    if (allTokensMatch) {
      return true;
    }
  }

  return false;
}
