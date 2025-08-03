// Common type definitions for the NeoPilot Extensions Hub

export interface Submodule {
  path: string;
  url: string;
  [key: string]: string | undefined;
}

export interface ExtensionInfo {
  id: string;
  version: string;
  submodule?: string;
  path?: string;
  [key: string]: any;
}

export interface ExtensionsToml {
  [key: string]: ExtensionInfo;
}

export interface GitSubmodule {
  name: string;
  path: string;
  url: string;
}

export interface S3Object {
  Key: string;
  LastModified?: Date;
}

export interface S3ListObjectsOutput {
  Contents?: S3Object[];
}

// Extend NodeJS.ProcessEnv with our custom environment variables
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      S3_ACCESS_KEY?: string;
      S3_SECRET_KEY?: string;
      S3_BUCKET?: string;
      SHOULD_PUBLISH?: string;
      S3_ENDPOINT?: string;
      S3_REGION?: string;
    }
  }
}
