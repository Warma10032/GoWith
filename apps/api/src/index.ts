import { buildApp } from "./lib/app";
import { env } from "./lib/env";

const app = buildApp();

await app.listen({ port: env.port, host: "0.0.0.0" });

