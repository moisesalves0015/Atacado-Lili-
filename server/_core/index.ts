import "dotenv/config";
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = "development";
}
import { createServer } from "http";
import { createApp } from "./app";
import { serveStatic, setupVite } from "./vite";

async function startServer() {
  const app = createApp();
  const server = createServer(app);

  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  let currentPort = Number(process.env.PORT || "3000");
  if (!Number.isInteger(currentPort) || currentPort < 1 || currentPort > 65535) throw new Error("Invalid PORT");
  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE" && currentPort < 65535) {
      console.warn(`Port ${currentPort} is in use, trying port ${currentPort + 1}...`);
      currentPort += 1;
      server.listen(currentPort, "0.0.0.0");
      return;
    }
    console.error("Server failed:", error.message);
    process.exit(1);
  });
  server.listen(currentPort, "0.0.0.0", () => {
    console.log(`Server listening on http://localhost:${currentPort}`);
  });
}

startServer().catch(error => { console.error(error); process.exit(1); });
