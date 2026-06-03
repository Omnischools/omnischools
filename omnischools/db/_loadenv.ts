// Side-effect: load .env.local before any module reads process.env (e.g. lib/env).
// Imported FIRST in tsx scripts so DATABASE_URL is set before the DB client initialises.
import { config } from "dotenv";
config({ path: ".env.local" });
