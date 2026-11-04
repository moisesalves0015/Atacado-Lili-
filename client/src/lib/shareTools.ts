import { toast } from "sonner";
import { formatDate, formatMoney } from "@shared/format";

export function downloadText(name: string, content: string, type = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function csvFromRows(rows: any[], includePhones = true) {
  const header = includePhones
    ? "Produto;Preço;Cliente;Quantidade;Telefone;Total;Data"
    : "Produto;Preço;Cliente;Quantidade;Total;Data";
  const lines = rows.map(row => {
    const cells = includePhones
      ? [row.productName, formatMoney(row.unitPriceCents), row.clientName, row.quantity, row.phone, formatMoney(row.totalCents), formatDate(row.orderDate)]
      : [row.productName, formatMoney(row.unitPriceCents), row.clientName, row.quantity, formatMoney(row.totalCents), formatDate(row.orderDate)];
    return cells.map(value => `"${String(value).replaceAll('"', '""')}"`).join(";");
  });
  return [header, ...lines].join("\n");
}

function dataUrlToFileSync(dataUrl: string, baseName: string): File | null {
  try {
    const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
    if (!match) return null;
    const mime = match[1];
    const b64 = match[2];
    const binStr = atob(b64);
    const len = binStr.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binStr.charCodeAt(i);
    }
    const ext = mime.includes("png") ? "png" : "jpg";
    const safeName = baseName.toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "produto";
    return new File([bytes], `${safeName}.${ext}`, { type: mime });
  } catch {
    return null;
  }
}

export function copyTextSync(text: string) {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  } catch {
    // Ignore fallback copy error
  }
  navigator.clipboard?.writeText(text).catch(() => {});
}

async function imageUrlToBlob(imageUrl: string): Promise<Blob> {
  const res = await fetch(imageUrl);
  return await res.blob();
}

async function imageUrlToPngBlob(imageUrl: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth || img.width || 800;
      canvas.height = img.naturalHeight || img.height || 800;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas context unavailable"));
        return;
      }
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error("PNG conversion failed"));
      }, "image/png");
    };
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = imageUrl;
  });
}

/**
 * Copia o texto e inicia o compartilhamento no WhatsApp (com foto + legenda quando possível).
 * Retorna `true` quando o compartilhamento foi INICIADO (WhatsApp/folha de compartilhamento aberta);
 * isso nunca significa que a mensagem foi enviada. Retorna `false` se a usuária cancelou.
 * `targetUrl` (ex.: convite de grupo) substitui o destino padrão `wa.me/?text=`; como links de grupo
 * não aceitam texto, o texto já fica copiado para colar.
 */
export async function shareReportOnWhatsApp(text: string, product?: any, options: { targetUrl?: string } = {}): Promise<boolean> {
  if (!text) return false;

  // Always copy the full report text synchronously first (keeps user gesture intact)
  copyTextSync(text);

  if (product?.imageUrl) {
    try {
      let file = dataUrlToFileSync(product.imageUrl, product.name || "produto");
      if (!file) {
        const blob = await imageUrlToBlob(product.imageUrl);
        const ext = blob.type.includes("png") ? "png" : "jpg";
        const safeName = (product.name || "produto").toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "produto";
        file = new File([blob], `${safeName}.${ext}`, { type: blob.type || "image/jpeg" });
      }

      const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      if (isMobile && typeof navigator.share === "function" && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
        // IMPORTANT: Do NOT pass `title` here; passing only `{ files, text }` ensures WhatsApp
        // uses `text` (the full multi-line report) as the photo caption (`legenda`).
        await navigator.share({
          files: [file],
          text,
        });
        return true;
      }

      // Desktop fallback: copy PNG image to clipboard and open WhatsApp with the full report text
      try {
        if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
          const pngBlob = await imageUrlToPngBlob(product.imageUrl);
          await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })]);
          toast.success("Texto preenchido no WhatsApp e foto copiada! Aperte Ctrl+V na conversa para enviar a foto com a legenda.");
        }
      } catch {
        // Ignore clipboard image error
      }
    } catch (err: any) {
      if (err?.name === "AbortError") return false;
    }
  }

  window.open(options.targetUrl ?? `https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  return true;
}

