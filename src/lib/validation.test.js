import { describe, expect, it } from "vitest";
import {
  validateExtensionsToml,
  validateGitmodules,
  validateManifest,
} from "./validation.js";

describe("validateManifest", () => {
  describe("given a valid manifest", () => {
    it("does not throw", () => {
      const validManifest = {
        name: "My Valid Extension",
        version: "1.0.0",
        authors: ["Me <me@example.com>"],
        description: "This extension is very cool",
        repository: "https://github.com/neopilot-ai/extensions",
      };

      expect(() => validateManifest(validManifest)).not.toThrow();
    });
  });

  describe('when the name starts with "Neopilot"', () => {
    it("throws a validation error", () => {
      expect(() =>
        validateManifest({ name: "Neopilot Something" }),
      ).toThrowErrorMatchingInlineSnapshot(
        `[Error: Extension names should not start with "Neopilot ", as they are all Neopilot extensions: "Neopilot Something".]`,
      );
    });
  });
});

describe("validateExtensionsToml", () => {
  describe("when `extensions.toml` only contains extensions with valid IDs", () => {
    it.each(["my-cool-extension", "base16"])(
      'does not throw for "%s"',
      (extensionId) => {
        const extensionsToml = {
          [extensionId]: {},
        };

        expect(() => validateExtensionsToml(extensionsToml)).not.toThrow();
      },
    );
  });

  describe("when `extensions.toml` contains an extension ID with invalid characters", () => {
    it.each(["BadExtension", "bad_extension"])(
      'throws a validation error for "%s"',
      (extensionId) => {
        const extensionsToml = {
          [extensionId]: {},
        };

        expect(() => validateExtensionsToml(extensionsToml)).toThrowError(
          `Extension IDs must only consist of lowercase letters, numbers, and hyphens ('-'): "${extensionId}".`,
        );
      },
    );
  });
});

describe("validateGitmodules", () => {
  describe("when an entry contains a non-HTTPS URL", () => {
    it("throws a validation error", () => {
      const gitmodulesContent = `
[submodule "extensions/my-extension"]
  path = extensions/my-extension
  url = git@github.com:me/my-extension.git
`;

      expect(() =>
        validateGitmodules(gitmodulesContent),
      ).toThrowErrorMatchingInlineSnapshot(
        `[Error: Submodules must use "https://" scheme.]`,
      );
    });
  });
});