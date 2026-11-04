const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dateFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export function formatMoney(cents = 0) {
  return currency.format(cents / 100);
}

export function formatDate(date?: string | Date | null) {
  if (!date) return "—";
  return dateFormatter.format(new Date(date));
}

export function formatDateTime(date?: string | Date | null) {
  if (!date) return "—";
  return dateTimeFormatter.format(new Date(date));
}

