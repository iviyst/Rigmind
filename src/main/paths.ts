import { app } from "electron";
import { join } from "node:path";

/** Files under /resources, in dev and in the installed app. */
export const resource = (...p: string[]) =>
  app.isPackaged ? join(process.resourcesPath, "resources", ...p) : join(__dirname, "..", "..", "resources", ...p);
