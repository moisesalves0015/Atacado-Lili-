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

      // On Vercel serverless, ephemeral disk files do not persist across instances,
      // so return the compressed dataUrl directly to persist inside the database/Firestore.
      if (process.env.VERCEL) {
        res.json({ url: dataUrl });
        return;
      }

      const extFromName = fileName?.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "");
      const ext = extFromName || (match[1] === "jpeg" ? "jpg" : match[1]) || "jpg";
      const safeName = `${crypto.randomUUID()}.${ext}`;
      const filePath = path.join(UPLOADS_DIR, safeName);
      fs.writeFileSync(filePath, Buffer.from(match[2], "base64"));
      res.json({ url: `/uploads/${safeName}` });
    } catch (err) {
      console.error("[Upload] Failed to save image:", err);
      res.status(500).json({ error: "Falha ao salvar imagem" });
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

