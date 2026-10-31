import "dotenv/config";

// These values are optional integrations inherited from the starter template.
// Spin Rally's current game server uses in-memory rooms and does not require
// an external identity provider or database to start or host multiplayer games.
export const env = {
  appId: process.env.APP_ID ?? "",
  appSecret: process.env.APP_SECRET ?? "",
  isProduction: process.env.NODE_ENV === "production",
  databaseUrl: process.env.DATABASE_URL ?? "",
};
