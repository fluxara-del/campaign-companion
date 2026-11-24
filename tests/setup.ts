// Zaštita: testovi ne smiju naslijediti produkcijski ili razvojni DATABASE_URL.
if (process.env.NODE_ENV === "production") {
  throw new Error("Testovi se ne pokreću s NODE_ENV=production.");
}
delete process.env.DATABASE_URL;
