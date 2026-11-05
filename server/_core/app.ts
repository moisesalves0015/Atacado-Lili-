import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { publicPlatformScript } from "./publicConfig";
import { appRouter } from "../routers";
import { createContext } from "./context";

export const UPLOADS_DIR = process.env.VERCEL
  ? path.join(os.tmpdir(), "vendaatacado-uploads")
  : path.resolve(process.cwd(), "data", "uploads");

export function createApp() {
  try {
    if (!fs.existsSync(UPLOADS_DIR)) {
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    }
  } catch {
    // Ignore read-only directory errors in restricted serverless environments
  }

  const app = express();
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  app.use("/uploads", express.static(UPLOADS_DIR, { maxAge: "365d", immutable: true }));

  app.post("/api/upload", (req, res) => {
    try {
      const { fileName, dataUrl } = req.body as { fileName?: string; dataUrl?: string };
      if (!dataUrl || typeof dataUrl !== "string") {
        res.status(400).json({ error: "Imagem inválida" });
        return;
      }
      const match = dataUrl.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,(.+)$/);
      if (!match) {
        res.status(400).json({ error: "Formato de imagem inválido" });
        return;
      }

      if (!process.env.VERCEL) {
        try {
          const extFromName = fileName?.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "");
          const ext = extFromName || (match[1] === "jpeg" ? "jpg" : match[1]) || "jpg";
          const safeName = `${crypto.randomUUID()}.${ext}`;
          const filePath = path.join(UPLOADS_DIR, safeName);
          fs.writeFileSync(filePath, Buffer.from(match[2], "base64"));
        } catch {
          // Ignore optional local backup write failure
        }
      }

      // Always return the compressed dataUrl so the image is persisted in the database
      // and immediately visible across all logged-in devices (PC, PWA, Vercel).
      res.json({ url: dataUrl });
    } catch (err) {
      console.error("[Upload] Failed to save image:", err);
      res.status(500).json({ error: "Falha ao salvar imagem" });
    }
  });

  app.options("/api/image-proxy", (_req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.set("Access-Control-Allow-Headers", "*");
    res.sendStatus(204);
  });

  app.get("/api/image-proxy", async (req, res) => {
    try {
      let rawUrl = typeof req.query.url === "string" ? req.query.url : "";
      if (req.url.includes("?url=")) {
        const afterUrl = req.url.slice(req.url.indexOf("?url=") + 5);
        if (afterUrl.startsWith("http%3A") || afterUrl.startsWith("https%3A")) {
          rawUrl = decodeURIComponent(afterUrl);
        } else if (afterUrl.startsWith("http://") || afterUrl.startsWith("https://")) {
          rawUrl = afterUrl;
        }
      }
      if (!rawUrl || !rawUrl.startsWith("http")) {
        res.status(400).send("URL de imagem inválida");
        return;
      }
      const parsed = new URL(rawUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        res.status(400).send("Protocolo não suportado");
        return;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      const upstreamRes = await fetch(rawUrl, {
        signal: controller.signal,
        headers: {
          Accept: "image/*,*/*;q=0.8",
          "User-Agent": "AtacadoLili-ImageProxy/1.0",
        },
      });
      clearTimeout(timeout);

      if (!upstreamRes.ok) {
        res.status(upstreamRes.status).send("Falha ao buscar imagem de origem");
        return;
      }

      const contentType = upstreamRes.headers.get("content-type") || "image/jpeg";
      res.set("Access-Control-Allow-Origin", "*");
      res.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
      res.set("Cache-Control", "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800");
      res.type(contentType);

      const buffer = Buffer.from(await upstreamRes.arrayBuffer());
      res.send(buffer);
    } catch (err) {
      console.error("[ImageProxy] Falha no proxy de imagem:", err);
      res.status(500).send("Erro ao processar imagem");
    }
  });

  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/api/platform/config.js", (_req, res) => {
    res.set("Cache-Control", "no-store").type("application/javascript").send(publicPlatformScript());
  });
  registerOAuthRoutes(app);

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  return app;
}

