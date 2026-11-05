import { toWaPhone } from "@shared/messaging";
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

export function getProxyImageUrl(imageUrl: string): string {
  if (!imageUrl || imageUrl.startsWith("data:") || imageUrl.startsWith("blob:")) {
    return imageUrl;
  }
  if (imageUrl.startsWith("/")) {
    return imageUrl;
  }
  return `/api/image-proxy?url=${encodeURIComponent(imageUrl)}`;
}

async function imageUrlToBlob(imageUrl: string): Promise<Blob> {
  const targetUrl = getProxyImageUrl(imageUrl);
  try {
    const res = await fetch(targetUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.blob();
  } catch (proxyErr) {
    if (targetUrl !== imageUrl) {
      try {
        const directRes = await fetch(imageUrl);
        if (directRes.ok) return await directRes.blob();
      } catch {
        // Fall back to throwing original proxy error
      }
    }
    throw proxyErr;
  }
}

async function imageUrlToPngBlob(imageUrl: string): Promise<Blob> {
  const targetUrl = getProxyImageUrl(imageUrl);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
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
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => {
      if (targetUrl !== imageUrl) {
        const directImg = new Image();
        directImg.crossOrigin = "anonymous";
        directImg.onload = () => {
          try {
            const canvas = document.createElement("canvas");
            canvas.width = directImg.naturalWidth || directImg.width || 800;
            canvas.height = directImg.naturalHeight || directImg.height || 800;
            const ctx = canvas.getContext("2d");
            if (!ctx) {
              reject(new Error("Canvas context unavailable"));
              return;
            }
            ctx.drawImage(directImg, 0, 0);
            canvas.toBlob(blob => {
              if (blob) resolve(blob);
              else reject(new Error("PNG conversion failed"));
            }, "image/png");
          } catch (err) {
            reject(err);
          }
        };
        directImg.onerror = () => reject(new Error("Failed to load image"));
        directImg.src = imageUrl;
        return;
      }
      reject(new Error("Failed to load image"));
    };
    img.src = targetUrl;
  });
}

/**
 * Copia o texto e inicia o compartilhamento no WhatsApp (com foto + legenda quando possível).
 * Retorna `true` quando o compartilhamento foi INICIADO (WhatsApp/folha de compartilhamento aberta);
 * isso nunca significa que a mensagem foi enviada. Retorna `false` se a usuária cancelou.
 * `targetUrl` (ex.: convite de grupo) substitui o destino padrão `wa.me/?text=`; como links de grupo
 * não aceitam texto, o texto já fica copiado para colar.
 */
export async function shareReportOnWhatsApp(
  text: string,
  product?: any,
  options: { targetUrl?: string; phone?: string } = {}
): Promise<boolean> {
  if (!text) return false;

  // Always copy the full report text synchronously first (keeps user gesture intact)
  copyTextSync(text);

  if (product?.imageUrl) {
    try {
      let file = dataUrlToFileSync(product.imageUrl, product.name || "produto");
      if (!file) {
        try {
          const blob = await imageUrlToBlob(product.imageUrl);
          const ext = blob.type.includes("png") ? "png" : "jpg";
          const safeName = (product.name || "produto").toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "produto";
          file = new File([blob], `${safeName}.${ext}`, { type: blob.type || "image/jpeg" });
        } catch (fetchErr) {
          console.warn("[Share] Não foi possível carregar o arquivo da imagem:", fetchErr);
        }
      }

      const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      if (file && isMobile && typeof navigator.share === "function" && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
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
          toast.success("Texto preenchido no WhatsApp e foto copiada! Aperte Ctrl+V na conversa para colar a foto com legenda.");
        }
      } catch {
        // Ignore clipboard image error
      }
    } catch (err: any) {
      if (err?.name === "AbortError") return false;
    }
  }

  const cleanPhone = options.phone ? toWaPhone(options.phone) : "";

  // SE FOR COBRANÇA INDIVIDUAL (tem telefone de cliente cadastrado):
  // Abre DIRETO na conversa com a cliente no WhatsApp
  if (cleanPhone) {
    const waUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`;
    window.open(waUrl, "_blank", "noopener,noreferrer");
    return true;
  }

  let waUrl = options.targetUrl;
  if (!waUrl) {
    waUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
  }

  window.open(waUrl, "_blank", "noopener,noreferrer");
  return true;
}

