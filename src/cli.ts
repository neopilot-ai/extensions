import { PutObjectCommand, S3 } from "@aws-sdk/client-s3";
import * as toml from "@iarna/toml";
import { strict as assert } from "node:assert";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { sortExtensionsToml } from "./lib/extensions-toml.js";
import { fileExists, readTomlFile } from "./lib/fs.js";
import {
  checkoutGitSubmodule,
  readGitmodules,
  sortGitmodules,
} from "./lib/git.js";
import { exec } from "./lib/process.js";
import {
  validateExtensionsToml,
  validateGitmodules,
  validateManifest,
} from "./lib/validation.js";
import {
  ExtensionInfo,
  ExtensionsToml,
  GitSubmodule,
  S3Object,
  S3ListObjectsOutput,
} from "./types";

// Constants
const EXTENSIONS_PREFIX = 'extensions';

// Main async function to handle top-level await
async function main(): Promise<void> {
  const {
    S3_ACCESS_KEY,
    S3_SECRET_KEY,
    S3_BUCKET,
    SHOULD_PUBLISH,
    S3_ENDPOINT,
    S3_REGION,
  } = process.env;
  
  // Initialize S3 client
  const s3 = new S3({
    endpoint: S3_ENDPOINT,
    region: S3_REGION,
    credentials: S3_ACCESS_KEY && S3_SECRET_KEY ? {
      accessKeyId: S3_ACCESS_KEY,
      secretAccessKey: S3_SECRET_KEY,
    } : undefined,
  });

  const USAGE = `
package-extensions [extensionId]

Package extensions and publish them to the NeoPilot extension blob store.

* If an extension ID is provided, only package that extension.
* Otherwise, if SHOULD_PUBLISH is set to true, package all extensions for
  which there is not already a package in the blob store.
* If SHOULD_PUBLISH is not set to true, then package any extensions that
  have been added or updated on this branch.

ENVIRONMENT VARIABLES
  S3_ACCESS_KEY     Access key for the blob store
  S3_SECRET_KEY     Secret key for the blob store
  S3_BUCKET         Name of the bucket where extensions are published
  SHOULD_PUBLISH    Whether to publish packages to the blob store.
                    Set this to "true" to publish the packages.
`;

// Get the extension ID from the command line arguments.
const [arg] = process.argv.slice(2);
let selectedExtensionId: string | undefined;

if (!arg) {
  console.log(USAGE);
  process.exit(1);
} else if (arg === "--help" || arg === "-h") {
  console.log(USAGE);
  process.exit(0);
} else if (arg === "--all") {
  selectedExtensionId = undefined;
} else {
  selectedExtensionId = arg;
}

// Main function
async function main() {
  try {
    /** Whether packages should be published to the blob store. */
    const shouldPublish = process.env.SHOULD_PUBLISH === "true";

    // Initialize S3 client if credentials are available
    const s3Client = process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY ? new S3({
      forcePathStyle: false,
      endpoint: process.env.S3_ENDPOINT || "https://nyc3.digitaloceanspaces.com",
      region: process.env.S3_REGION || "nyc3",
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY,
        secretAccessKey: process.env.S3_SECRET_KEY,
      },
    }) : null;

    const S3_BUCKET = process.env.S3_BUCKET || 'neopilot-extensions';
    const EXTENSIONS_PREFIX = "extensions";

    // Read and validate extensions and git modules
    const extensionsToml = await readTomlFile("extensions.toml");
    await fs.mkdir("build", { recursive: true });
    
    try {
      // Read and validate extensions.toml first
      validateExtensionsToml(extensionsToml);
      
      // Read .gitmodules file as a string for validation
      const gitModulesContent = await fs.readFile(".gitmodules", "utf-8");
      validateGitmodules(gitModulesContent);
      
      // For operations that need the parsed gitmodules
      const gitModules = await readGitmodules(".gitmodules");

      // Sort files to maintain consistent ordering
      await sortExtensionsToml("extensions.toml");
      await sortGitmodules(".gitmodules");

      // Get extensions to process
      const extensionIds = shouldPublish
        ? await unpublishedExtensionIds(extensionsToml)
        : await changedExtensionIds(extensionsToml);

      // Process each extension
      for (const extensionId of extensionIds) {
        if (selectedExtensionId && extensionId !== selectedExtensionId) {
          continue;
        }

        const extensionInfo = extensionsToml[extensionId];
        if (!extensionInfo) {
          console.error(`No such extension: ${extensionId}`);
          process.exit(1);
        }

        console.log(`Packaging ${extensionId}@${extensionInfo.version}...`);

        if (!extensionInfo.submodule) {
          console.error(`No submodule found for extension: ${extensionId}`);
          process.exit(1);
        }

        const submodulePath = extensionInfo.submodule;
        const extensionPath = extensionInfo.path
          ? path.join(submodulePath, extensionInfo.path)
          : submodulePath;

        if (shouldPublish) {
          await packageExtension(
            extensionId, 
            extensionPath, 
            extensionInfo.version, 
            true,
            {
              s3Client: s3Client,
              S3_BUCKET: S3_BUCKET,
              EXTENSIONS_PREFIX: EXTENSIONS_PREFIX
            }
          );
        }
      }
    } finally {
      // Clean up build directory
      await fs.rm("build", { recursive: true, force: true });
    }
  } catch (error) {
    console.error('Error in main function:', error);
    process.exit(1);
  }
}
}

/**
 * @param {string} extensionId
 * @param {string} extensionPath
 * @param {string} extensionVersion
 * @param {boolean} shouldPublish
 */
interface S3ClientOptions {
  s3Client: S3 | null;
  S3_BUCKET: string;
  EXTENSIONS_PREFIX: string;
}

async function packageExtension(
  extensionId: string,
  extensionPath: string,
  extensionVersion: string,
  shouldPublish: boolean,
  s3Options: S3ClientOptions
): Promise<void> {
  const outputDir = "output";

  const SCRATCH_DIR = "./scratch";
  await fs.mkdir(SCRATCH_DIR, { recursive: true });

  if (await fileExists(path.join(extensionPath, "extension.json"))) {
    throw new Error(
      "The `extension.json` manifest format has been superseded by `extension.toml`",
    );
  }

  const pathToExtensionToml = path.join(extensionPath, "extension.toml");
  if (await fileExists(pathToExtensionToml)) {
    const extensionToml = await readTomlFile(pathToExtensionToml);

    if (extensionToml.id !== extensionId) {
      throw new Error(
        [
          "IDs in `extensions.toml` and `extension.toml` do not match:",
          "",
          `extensions.toml: ${extensionId}`,
          ` extension.toml: ${extensionToml.id}`,
        ].join("\n"),
      );
    }
  }

  const neopilotExtensionOutput = await exec(
    "./neopilot-extension",
    [
      "--scratch-dir",
      SCRATCH_DIR,
      "--source-dir",
      extensionPath,
      "--output-dir",
      outputDir,
    ],
    {
      env: {
        PATH: process.env["PATH"],
        RUST_LOG: "info",
      },
    },
  );
  console.log(neopilotExtensionOutput.stdout);

  const warnings = neopilotExtensionOutput.stderr
    .split("\n")
    .filter((line) => line.includes("WARN"));
  for (const warning of warnings) {
    console.log(warning);
  }

  const manifestJson = await fs.readFile(
    path.join(outputDir, "manifest.json"),
    "utf-8",
  );
  const metadata = JSON.parse(manifestJson);

  if (metadata.version !== extensionVersion) {
    throw new Error(
      [
        `Incorrect version for extension ${extensionId} (${metadata.name})`,
        "",
        `Expected version: ${extensionVersion}`,
        `Actual version: ${metadata.version}`,
      ].join("\n"),
    );
  }

  validateManifest(metadata);

  if (shouldPublish && s3Options.s3Client) {
    console.log(`Uploading ${extensionId} version ${extensionVersion}`);
    const entries = await fs.readdir(outputDir);
    
    for (const filename of entries) {
      const filePath = path.join(outputDir, filename);
      const key = `${s3Options.EXTENSIONS_PREFIX}/${extensionId}/${extensionVersion}/${filename}`;
      
      console.log(`Uploading ${filePath} to s3://${s3Options.S3_BUCKET}/${key}`);
      
      await s3Options.s3Client!.send(
        new PutObjectCommand({
          Bucket: s3Options.S3_BUCKET,
          Key: key,
          Body: await fs.readFile(filePath),
          ContentType: filename.endsWith('.gz') ? 'application/gzip' : 'application/octet-stream',
          ACL: 'public-read',
        })
      );
    }
    
    console.log(`Successfully uploaded ${entries.length} files for ${extensionId}@${extensionVersion}`);
  }
}

// ...

async function getPublishedVersionsByExtensionId(): Promise<Map<string, Set<string>>> {
  if (!process.env.S3_ACCESS_KEY || !process.env.S3_SECRET_KEY || !process.env.S3_BUCKET) {
    console.warn(
      "S3 credentials not configured. Will not check for existing versions.",
    );
    return new Map();
  }

  const s3 = new S3({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY,
      secretAccessKey: process.env.S3_SECRET_KEY,
    },
  });

  const bucketList: S3Object[] = [];
  let continuationToken: string | undefined;
  
  do {
    const response = await s3.listObjectsV2({
      Bucket: process.env.S3_BUCKET!,
      ContinuationToken: continuationToken,
    });
    
    if (response.Contents) {
      // Cast the S3 objects to our S3Object type
      const contents = response.Contents.map(obj => ({
        Key: obj.Key || '',
        LastModified: obj.LastModified
      }));
      bucketList.push(...contents);
    }
    
    if (response.NextContinuationToken) {
      continuationToken = response.NextContinuationToken;
    } else {
      continuationToken = undefined;
    }
  } while (continuationToken);

  const versionsByExtensionId = new Map<string, Set<string>>();
  
  for (const object of bucketList) {
    if (!object.Key) continue;
    
    const match = object.Key.match(/^(\w+)\/([^\/]+)\/[^\/]+$/);
    if (match) {
      const [, extensionId, version] = match;
      if (!versionsByExtensionId.has(extensionId)) {
        versionsByExtensionId.set(extensionId, new Set());
      }
      versionsByExtensionId.get(extensionId)?.add(version);
    }
  }

  return versionsByExtensionId;
}

/**
 * @param {Record<string, any>} extensionsToml
 */
export async function unpublishedExtensionIds(extensionsToml: ExtensionsToml): Promise<string[]> {
  const publishedExtensionVersions = await getPublishedVersionsByExtensionId();

  const result: string[] = [];
  for (const [extensionId, extensionInfo] of Object.entries(extensionsToml)) {
    const versions = publishedExtensionVersions.get(extensionId);
    if (!versions || !versions.has(extensionInfo.version)) {
      result.push(extensionId);
    }
  }

  console.log("Extensions needing to be published:", result.join(", "));
  return result;
}

/**
 * @param {Record<string, any>} extensionsToml
 */
async function changedExtensionIds(extensionsToml: ExtensionsToml): Promise<string[]> {
  const { stdout: extensionsContents } = await exec("git", [
    "show",
    "origin/main:extensions.toml",
  ]);
  
  const mainExtensionsToml = toml.parse(extensionsContents) as ExtensionsToml;

  const result: string[] = [];
  for (const [extensionId, extensionInfo] of Object.entries(extensionsToml)) {
    const mainExtension = mainExtensionsToml[extensionId];
    if (mainExtension?.version === extensionInfo.version) {
      continue;
    }

    result.push(extensionId);
  }

  console.log("Extensions changed from main:", result.join(", "));
  return result;
}
