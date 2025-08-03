// Extension ID pattern for validation
const EXTENSION_ID_PATTERN = /^[a-z0-9\-]+$/;

interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

interface ExtensionsTomlValidationResult extends ValidationResult {
  submodules?: any[];
}

interface Manifest {
  name: string;
  version?: string;
  authors?: string[];
  description?: string;
  repository?: string;
}

interface GitSubmodule {
  path: string;
  url: string;
}

interface Gitmodules {
  [key: string]: GitSubmodule;
}

/**
 * Validates extensions.toml file structure
 * @param extensionsToml - the parsed extensions.toml object
 * @throws {Error} If validation fails
 */
function validateExtensionsToml(extensionsToml: Record<string, unknown>): void {
  if (!extensionsToml || typeof extensionsToml !== 'object') {
    throw new Error('extensions.toml must be an object');
  }

  for (const extensionId of Object.keys(extensionsToml)) {
    if (!EXTENSION_ID_PATTERN.test(extensionId)) {
      throw new Error(
        `Extension IDs must only consist of lowercase letters, numbers, and hyphens ('-'): "${extensionId}".`
      );
    }
  }

  // Check if extensions section exists and has the correct type
  const extensions = extensionsToml as { extensions?: Record<string, unknown> };
  
  if (!extensions.extensions || typeof extensions.extensions !== "object") {
    throw new Error("Missing or invalid extensions section");
  } else {
    // Validate each extension ID
    for (const extensionId in extensions.extensions) {
      if (!EXTENSION_ID_PATTERN.test(extensionId)) {
        throw new Error(
          `Invalid extension ID: ${extensionId}. Must contain only lowercase letters, numbers, and hyphens`,
        );
      }
      
      const extension = extensions.extensions[extensionId];
      if (!extension || typeof extension !== "object") {
        throw new Error(`Extension ${extensionId} must be an object`);
      }

      // Type assertion for the extension object
      const ext = extension as { version?: unknown; source?: unknown };

      // Validate required fields
      if (!ext.version || typeof ext.version !== "string") {
        throw new Error(`Extension ${extensionId} missing or invalid version`);
      }

      if (!ext.source || typeof ext.source !== "string") {
        throw new Error(`Extension ${extensionId} missing or invalid source`);
      }
    }
  }
}

/**
 * Validates a manifest object
 * @param manifest - the manifest object to validate
 * @throws {Error} If validation fails
 */
function validateManifest(manifest: any): ValidationResult {
  const errors: string[] = [];

  if (!manifest || typeof manifest !== "object") {
    return { isValid: false, errors: ["Manifest must be an object"] };
  }

  // Required fields
  const requiredFields = ["name", "version", "description"];
  for (const field of requiredFields) {
    if (!manifest[field] || typeof manifest[field] !== "string") {
      errors.push(`Missing or invalid required field: ${field}`);
    }
  }

  // Validate name format (should be extension ID format)
  if (manifest.name && !EXTENSION_ID_PATTERN.test(manifest.name)) {
    errors.push(
      "Manifest name must contain only lowercase letters, numbers, and hyphens",
    );
  }

  // Validate version format (semantic versioning)
  if (manifest.version) {
    const versionRegex = /^\d+\.\d+\.\d+(-[a-zA-Z0-9\-\.]+)?$/;
    if (!versionRegex.test(manifest.version)) {
      errors.push(
        "Version must follow semantic versioning format (e.g., 1.0.0 or 1.0.0-beta.1)",
      );
    }
  }

  // Validate optional fields
  if (manifest.author && typeof manifest.author !== "string") {
    errors.push("Author must be a string");
  }

  if (manifest.license && typeof manifest.license !== "string") {
    errors.push("License must be a string");
  }

  if (manifest.repository && typeof manifest.repository !== "string") {
    errors.push("Repository must be a string");
  }

  if (
    manifest.keywords &&
    (!Array.isArray(manifest.keywords) ||
      !manifest.keywords.every((k: any) => typeof k === "string"))
  ) {
    errors.push("Keywords must be an array of strings");
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

interface Submodule {
  name: string;
  lineNumber: number;
  path: string | null;
  url: string | null;
}

interface GitmodulesValidationResult extends ValidationResult {
  submodules: Submodule[];
}

/**
 * Validates .gitmodules file structure
 * @param gitmodules - the raw .gitmodules file content
 * @returns validation result with isValid boolean, errors array, and submodules
 */
function validateGitmodules(gitmodules: string): GitmodulesValidationResult {
  const errors: string[] = [];

  if (typeof gitmodules !== "string") {
    return {
      isValid: false,
      errors: ["Gitmodules must be a string"],
      submodules: [],
    };
  }

  const lines = gitmodules
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  let currentSubmodule: Submodule | null = null;
  const submodules: Submodule[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for submodule section header
    const submoduleMatch = line.match(/^\[submodule "(.+)"\]$/);
    if (submoduleMatch) {
      if (currentSubmodule) {
        submodules.push(currentSubmodule);
      }
      currentSubmodule = {
        name: submoduleMatch[1],
        lineNumber: i + 1,
        path: null,
        url: null,
      };
      continue;
    }

    // Check for path and url properties
    const pathMatch = line.match(/^path\s*=\s*(.+)$/);
    const urlMatch = line.match(/^url\s*=\s*(.+)$/);

    if (pathMatch && currentSubmodule) {
      currentSubmodule.path = pathMatch[1].trim();
    } else if (urlMatch && currentSubmodule) {
      currentSubmodule.url = urlMatch[1].trim();
    } else if (line.startsWith("[") && !submoduleMatch) {
      errors.push(`Invalid section header at line ${i + 1}: ${line}`);
    } else if (
      !line.startsWith("#") &&
      !pathMatch &&
      !urlMatch &&
      currentSubmodule
    ) {
      errors.push(`Invalid property at line ${i + 1}: ${line}`);
    }
  }

  // Add the last submodule
  if (currentSubmodule) {
    submodules.push(currentSubmodule);
  }

  // Validate each submodule
  for (const submodule of submodules) {
    if (!submodule.path) {
      errors.push(`Submodule "${submodule.name}" missing path property`);
    }

    if (!submodule.url) {
      errors.push(`Submodule "${submodule.name}" missing url property`);
    }

    // Validate URL format (basic check for git URLs)
    if (submodule.url && !submodule.url.match(/^(https?:\/\/|git@|ssh:\/\/)/)) {
      errors.push(
        `Submodule "${submodule.name}" has invalid URL format: ${submodule.url}`,
      );
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    submodules,
  };
}

/* Export the validation functions */
export {
  validateExtensionsToml,
  validateManifest,
  validateGitmodules,
  EXTENSION_ID_PATTERN,
};
