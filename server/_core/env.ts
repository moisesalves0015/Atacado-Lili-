// Platform values are read at use time. See the Webdev service/authentication skills.
export const ENV = {
  get appId() { return (process.env.MANUS_PROJECT_ID || "vendaatacado-local").trim(); },
  get cookieSecret() { return (process.env.MANUS_JWT_SECRET || "vendaatacado-local-jwt-secret-key-2026").trim(); },
  get databaseUrl() { return (process.env.DATABASE_URL ?? "").trim(); },
  get oAuthServerUrl() { return (process.env.MANUS_OAUTH_API_URL ?? "").trim(); },
  // Preserve the legacy hint when supplied; otherwise roles remain application data.
  get ownerOpenId() { return (process.env.OWNER_OPEN_ID ?? "").trim(); },
  get isProduction() { return (process.env.NODE_ENV ?? "").trim() === "production"; },
  get forgeApiUrl() { return (process.env.MANUS_API_URL ?? "").trim(); },
  get forgeApiKey() { return (process.env.MANUS_API_KEY ?? "").trim(); },
  get adminUser() { return (process.env.ADMIN_USER || "admin").trim(); },
  get adminPassword() { return (process.env.ADMIN_PASSWORD || "1234").trim(); },
};
