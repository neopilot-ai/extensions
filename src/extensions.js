import { sortExtensionsToml } from "./lib/extensions-toml.js";
import { sortGitmodules } from "./lib/git.js";

(async () => {
  try {
    await sortExtensionsToml("extensions.toml");
    await sortGitmodules(".gitmodules");
  } catch (error) {
    console.error("Error sorting files:", error);
    process.exit(1);
  }
})();
