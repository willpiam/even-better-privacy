/** Compatibility export; every test executes the production dispatcher. */
export { handleRequest as handleRequestForTest } from "../routes.ts";
