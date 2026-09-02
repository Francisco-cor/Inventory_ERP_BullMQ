import { validateEnv } from "@erp/env";

export const config = validateEnv(process.env);
