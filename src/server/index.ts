import { createApp } from "./app";
import { parseConfig } from "./config";
import { createRuntime } from "./runtime";

/**
 * The app configured from the current environment, for in-process requests (`app.request`). It does
 * not read a key file or listen, but building it is not free of side effects: `createRuntime` makes a
 * temp directory in fixture mode and the exchange log's directory when `KENSAKU_EXCHANGE_LOG` is set.
 * `main.ts` is the entry that loads the key and listens.
 */
export const app = createApp(createRuntime(parseConfig(process.env)));
