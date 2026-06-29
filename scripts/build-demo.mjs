import { build } from "vite";

process.env.VITE_DEMO_MODE = "true";

await build();
