import { createApp } from "./app";
import { parseConfig } from "./config";
import { createRuntime } from "./runtime";

export { createApp } from "./app";
export type { AppDeps } from "./app";

/**
 * The app configured from the current environment, without reading any key file. Importing this
 * module has no side effect; `main.ts` is the entry that loads the key and listens.
 */
export const app = createApp(createRuntime(parseConfig(process.env)));
