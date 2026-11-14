// openrgb-sdk ships .d.ts files under dist/, but its package.json points "types" at a missing path.
declare module "openrgb-sdk" {
  export { default as Client } from "openrgb-sdk/dist/client";
}
