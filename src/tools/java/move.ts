import { z } from 'zod';
import { Config } from '../../config.js';
import { OpenRewriteClient } from '../../engines/openrewrite/client.js';
import { buildChangePackageRecipe } from '../../engines/openrewrite/recipe-builder.js';
import { formatRefactoringResult } from '../../utils/diff-utils.js';
import { validatePackageName, validateFullyQualifiedClassName } from '../../utils/validation.js';

// Move Class Schema
export const javaMoveClassSchema = z.object({
  projectPath: z.string().describe('Path to the Java project root'),
  oldPackage: z.string().describe('Current package name (e.g., com.example.old)'),
  newPackage: z.string().describe('New package name (e.g., com.example.new)'),
  recursive: z.boolean().default(true).describe('Also move sub-packages (default: true)'),
  dryRun: z.boolean().default(true).describe('Preview changes without applying (default: true)'),
  javaVersion: z.string().optional().describe('Java version to use (e.g., "17.0.16-amzn", "21.0.8-tem")'),
});

export type JavaMoveClassParams = z.infer<typeof javaMoveClassSchema>;

export async function javaMoveClass(config: Config, params: JavaMoveClassParams): Promise<string> {
  // Validate package names
  const oldValidation = validatePackageName(params.oldPackage);
  if (!oldValidation.valid) {
    return formatRefactoringResult({
      success: false,
      message: oldValidation.error || 'Invalid old package name',
      filesChanged: 0,
    });
  }

  const newValidation = validatePackageName(params.newPackage);
  if (!newValidation.valid) {
    return formatRefactoringResult({
      success: false,
      message: newValidation.error || 'Invalid new package name',
      filesChanged: 0,
    });
  }

  try {
    const client = new OpenRewriteClient(config);

    const recipe = buildChangePackageRecipe(
      params.oldPackage,
      params.newPackage,
      params.recursive
    );

    const result = await client.runRecipeWithBuildTool(
      params.projectPath,
      recipe,
      params.dryRun,
      params.javaVersion
    );

    return formatRefactoringResult({
      success: result.success,
      message: result.success
        ? (params.dryRun
            ? `Dry run: would move classes from '${params.oldPackage}' to '${params.newPackage}'`
            : `Moved classes from '${params.oldPackage}' to '${params.newPackage}'`)
        : result.message,
      filesChanged: result.filesChanged || 0,
      diff: result.diff,
      errors: result.errors,
    });
  } catch (error) {
    return formatRefactoringResult({
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error',
      filesChanged: 0,
    });
  }
}

// Tool definition for MCP
export const javaMoveClassTool = {
  name: 'java_move_class',
  description: 'Move Java class(es) to a different package and update all imports using OpenRewrite',
  inputSchema: {
    type: 'object',
    properties: {
      projectPath: {
        type: 'string',
        description: 'Path to the Java project root',
      },
      oldPackage: {
        type: 'string',
        description: 'Current package name (e.g., com.example.old)',
      },
      newPackage: {
        type: 'string',
        description: 'New package name (e.g., com.example.new)',
      },
      recursive: {
        type: 'boolean',
        description: 'Also move sub-packages (default: true)',
      },
      dryRun: {
        type: 'boolean',
        description: 'Preview changes without applying (default: true)',
      },
      javaVersion: {
        type: 'string',
        description: 'Java version to use (e.g., "17.0.16-amzn", "21.0.8-tem")',
      },
    },
    required: ['projectPath', 'oldPackage', 'newPackage'],
  },
};
