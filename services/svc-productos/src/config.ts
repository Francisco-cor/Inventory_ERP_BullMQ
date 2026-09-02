import { validateEnv } from "@erp/env";

export const config = validateEnv(process.env);
// Tipado: config.PORT, config.DATABASE_URL, etc. Fail-fast si falta var.
