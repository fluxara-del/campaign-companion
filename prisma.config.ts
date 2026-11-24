import "dotenv/config";
import { defineConfig } from "prisma/config";

// Prisma 7: URL baze dolazi iz konfiguracije, ne iz schema.prisma.
// Zadano je lokalna razvojna baza; produkcija uvijek postavlja DATABASE_URL eksplicitno.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "file:./data/dev.db",
  },
});
