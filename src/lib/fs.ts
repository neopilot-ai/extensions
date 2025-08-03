import fs from "node:fs/promises";
import toml from "@iarna/toml";

interface TomlObject {
  [key: string]: any;
}

/**
 * Reads and parses a TOML file
 * @param path - Path to the TOML file
 * @returns Parsed TOML object
 * @throws {Error} If the file cannot be read or parsed
 */
export async function readTomlFile(path: string): Promise<TomlObject> {
  try {
    const tomlContents = await fs.readFile(path, "utf-8");
    return toml.parse(tomlContents) as TomlObject;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse TOML file '${path}': ${errorMessage}`);
  }
}

/**
 * Checks if a file exists at the given path
 * @param path - Path to check
 * @returns True if the path exists and is a file, false otherwise
 */
export async function fileExists(path: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path);
    return stat.isFile();
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return false;
    }

    throw error;
  }
}
