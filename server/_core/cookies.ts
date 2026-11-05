import type { CookieOptions, Request } from "express";

export function getSessionCookieOptions(req?: Request): CookieOptions {
  const isHttps =
    req?.secure ||
    req?.headers?.["x-forwarded-proto"] === "https" ||
    process.env.NODE_ENV === "production" ||
    process.env.NODE_ENV === "test";

  if (isHttps) {
    return { httpOnly: true, path: "/", sameSite: "none", secure: true };
  }

  return { httpOnly: true, path: "/", sameSite: "lax", secure: false };
}
