import { z } from 'zod';
import { existsSync } from 'fs';
import { join, resolve } from 'path';

// Schema for tool parameters
export const detectProjectTypeSchema = z.object({
  projectPath: z.string().describe('Path to the project root directory'),
});

export type DetectProjectTypeParams = z.infer<typeof detectProjectTypeSchema>;

export interface ProjectInfo {
  projectPath: string;
  languages: string[];
  buildSystem?: string;
  javaVersion?: string;
  typescriptConfig?: string;
  packageManager?: string;
}

export async function detectProjectType(params: DetectProjectTypeParams): Promise<string> {
  const projectPath = resolve(params.projectPath);

  if (!existsSync(projectPath)) {
    return JSON.stringify({
      success: false,
      error: `Project path does not exist: ${projectPath}`,
    }, null, 2);
  }

  const info: ProjectInfo = {
    projectPath,
    languages: [],
  };

  // Detect Java projects
  const pomPath = join(projectPath, 'pom.xml');
  const gradlePath = join(projectPath, 'build.gradle');
  const gradleKtsPath = join(projectPath, 'build.gradle.kts');

  if (existsSync(pomPath)) {
    info.languages.push('java');
    info.buildSystem = 'maven';
  } else if (existsSync(gradlePath) || existsSync(gradleKtsPath)) {
    info.languages.push('java');
    info.buildSystem = 'gradle';
  }

  // Check for src/main/java directory as additional indicator
  if (existsSync(join(projectPath, 'src', 'main', 'java'))) {
    if (!info.languages.includes('java')) {
      info.languages.push('java');
    }
  }

  // Detect TypeScript/JavaScript projects
  const tsconfigPath = join(projectPath, 'tsconfig.json');
  const packageJsonPath = join(projectPath, 'package.json');

  if (existsSync(tsconfigPath)) {
    info.languages.push('typescript');
    info.typescriptConfig = tsconfigPath;
  }

  // Detect package manager
  if (existsSync(packageJsonPath)) {
    if (!info.languages.includes('typescript') && !info.languages.includes('javascript')) {
      info.languages.push('javascript');
    }

    // Check for lock files to determine package manager
    if (existsSync(join(projectPath, 'pnpm-lock.yaml'))) {
      info.packageManager = 'pnpm';
    } else if (existsSync(join(projectPath, 'yarn.lock'))) {
      info.packageManager = 'yarn';
    } else if (existsSync(join(projectPath, 'package-lock.json'))) {
      info.packageManager = 'npm';
    } else {
      info.packageManager = 'npm'; // default
    }
  }

  // Check for Angular-specific files
  if (existsSync(join(projectPath, 'angular.json'))) {
    if (!info.languages.includes('typescript')) {
      info.languages.push('typescript');
    }
  }

  return JSON.stringify({
    success: true,
    project: info,
  }, null, 2);
}

// Tool definition for MCP
export const detectProjectTypeTool = {
  name: 'detect_project_type',
  description: 'Detect Java/TypeScript project type, build system, and configuration',
  inputSchema: {
    type: 'object',
    properties: {
      projectPath: {
        type: 'string',
        description: 'Path to the project root directory',
      },
    },
    required: ['projectPath'],
  },
};

export const utilityTools = [detectProjectTypeTool];
