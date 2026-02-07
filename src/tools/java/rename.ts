import { z } from 'zod';
import { Config } from '../../config.js';
import { OpenRewriteClient } from '../../engines/openrewrite/client.js';
import {
  buildChangeTypeRecipe,
  buildChangeMethodNameRecipe,
  buildRenameFieldRecipe,
  createMethodPattern,
} from '../../engines/openrewrite/recipe-builder.js';
import { formatRefactoringResult } from '../../utils/diff-utils.js';
import { validateFullyQualifiedClassName, validateJavaIdentifier } from '../../utils/validation.js';

// Rename Class Schema
export const javaRenameClassSchema = z.object({
  projectPath: z.string().describe('Path to the Java project root'),
  oldFullyQualifiedName: z.string().describe('Current fully qualified class name (e.g., com.example.OldClass)'),
  newFullyQualifiedName: z.string().describe('New fully qualified class name (e.g., com.example.NewClass)'),
  dryRun: z.boolean().default(true).describe('Preview changes without applying (default: true)'),
});

export type JavaRenameClassParams = z.infer<typeof javaRenameClassSchema>;

// Rename Method Schema
export const javaRenameMethodSchema = z.object({
  projectPath: z.string().describe('Path to the Java project root'),
  className: z.string().describe('Fully qualified class name containing the method'),
  oldMethodName: z.string().describe('Current method name'),
  newMethodName: z.string().describe('New method name'),
  parameterTypes: z.array(z.string()).optional().describe('Optional: parameter types to match specific overload'),
  dryRun: z.boolean().default(true).describe('Preview changes without applying (default: true)'),
});

export type JavaRenameMethodParams = z.infer<typeof javaRenameMethodSchema>;

// Rename Field Schema
export const javaRenameFieldSchema = z.object({
  projectPath: z.string().describe('Path to the Java project root'),
  className: z.string().describe('Fully qualified class name containing the field'),
  oldFieldName: z.string().describe('Current field name'),
  newFieldName: z.string().describe('New field name'),
  dryRun: z.boolean().default(true).describe('Preview changes without applying (default: true)'),
});

export type JavaRenameFieldParams = z.infer<typeof javaRenameFieldSchema>;

export async function javaRenameClass(config: Config, params: JavaRenameClassParams): Promise<string> {
  // Validate class names
  const oldValidation = validateFullyQualifiedClassName(params.oldFullyQualifiedName);
  if (!oldValidation.valid) {
    return formatRefactoringResult({
      success: false,
      message: oldValidation.error || 'Invalid old class name',
      filesChanged: 0,
    });
  }

  const newValidation = validateFullyQualifiedClassName(params.newFullyQualifiedName);
  if (!newValidation.valid) {
    return formatRefactoringResult({
      success: false,
      message: newValidation.error || 'Invalid new class name',
      filesChanged: 0,
    });
  }

  try {
    const client = new OpenRewriteClient(config);

    const recipe = buildChangeTypeRecipe(
      params.oldFullyQualifiedName,
      params.newFullyQualifiedName
    );

    const result = await client.runRecipeWithBuildTool(
      params.projectPath,
      recipe,
      params.dryRun
    );

    return formatRefactoringResult({
      success: result.success,
      message: result.success
        ? (params.dryRun
            ? `Dry run: would rename '${params.oldFullyQualifiedName}' to '${params.newFullyQualifiedName}'`
            : `Renamed '${params.oldFullyQualifiedName}' to '${params.newFullyQualifiedName}'`)
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

export async function javaRenameMethod(config: Config, params: JavaRenameMethodParams): Promise<string> {
  // Validate class name
  const classValidation = validateFullyQualifiedClassName(params.className);
  if (!classValidation.valid) {
    return formatRefactoringResult({
      success: false,
      message: classValidation.error || 'Invalid class name',
      filesChanged: 0,
    });
  }

  // Validate method names
  const oldMethodValidation = validateJavaIdentifier(params.oldMethodName);
  if (!oldMethodValidation.valid) {
    return formatRefactoringResult({
      success: false,
      message: oldMethodValidation.error || 'Invalid old method name',
      filesChanged: 0,
    });
  }

  const newMethodValidation = validateJavaIdentifier(params.newMethodName);
  if (!newMethodValidation.valid) {
    return formatRefactoringResult({
      success: false,
      message: newMethodValidation.error || 'Invalid new method name',
      filesChanged: 0,
    });
  }

  try {
    const client = new OpenRewriteClient(config);

    const methodPattern = createMethodPattern(
      params.className,
      params.oldMethodName,
      params.parameterTypes
    );

    const recipe = buildChangeMethodNameRecipe(methodPattern, params.newMethodName);

    const result = await client.runRecipeWithBuildTool(
      params.projectPath,
      recipe,
      params.dryRun
    );

    return formatRefactoringResult({
      success: result.success,
      message: result.success
        ? (params.dryRun
            ? `Dry run: would rename method '${params.oldMethodName}' to '${params.newMethodName}'`
            : `Renamed method '${params.oldMethodName}' to '${params.newMethodName}'`)
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

export async function javaRenameField(config: Config, params: JavaRenameFieldParams): Promise<string> {
  // Validate class name
  const classValidation = validateFullyQualifiedClassName(params.className);
  if (!classValidation.valid) {
    return formatRefactoringResult({
      success: false,
      message: classValidation.error || 'Invalid class name',
      filesChanged: 0,
    });
  }

  // Validate field names
  const oldFieldValidation = validateJavaIdentifier(params.oldFieldName);
  if (!oldFieldValidation.valid) {
    return formatRefactoringResult({
      success: false,
      message: oldFieldValidation.error || 'Invalid old field name',
      filesChanged: 0,
    });
  }

  const newFieldValidation = validateJavaIdentifier(params.newFieldName);
  if (!newFieldValidation.valid) {
    return formatRefactoringResult({
      success: false,
      message: newFieldValidation.error || 'Invalid new field name',
      filesChanged: 0,
    });
  }

  try {
    const client = new OpenRewriteClient(config);

    const recipe = buildRenameFieldRecipe(
      params.className,
      params.oldFieldName,
      params.newFieldName
    );

    const result = await client.runRecipeWithBuildTool(
      params.projectPath,
      recipe,
      params.dryRun
    );

    return formatRefactoringResult({
      success: result.success,
      message: result.success
        ? (params.dryRun
            ? `Dry run: would rename field '${params.oldFieldName}' to '${params.newFieldName}'`
            : `Renamed field '${params.oldFieldName}' to '${params.newFieldName}'`)
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

// Tool definitions for MCP
export const javaRenameClassTool = {
  name: 'java_rename_class',
  description: 'Rename a Java class and update all references using OpenRewrite',
  inputSchema: {
    type: 'object',
    properties: {
      projectPath: {
        type: 'string',
        description: 'Path to the Java project root',
      },
      oldFullyQualifiedName: {
        type: 'string',
        description: 'Current fully qualified class name (e.g., com.example.OldClass)',
      },
      newFullyQualifiedName: {
        type: 'string',
        description: 'New fully qualified class name (e.g., com.example.NewClass)',
      },
      dryRun: {
        type: 'boolean',
        description: 'Preview changes without applying (default: true)',
      },
    },
    required: ['projectPath', 'oldFullyQualifiedName', 'newFullyQualifiedName'],
  },
};

export const javaRenameMethodTool = {
  name: 'java_rename_method',
  description: 'Rename a Java method and update all call sites using OpenRewrite',
  inputSchema: {
    type: 'object',
    properties: {
      projectPath: {
        type: 'string',
        description: 'Path to the Java project root',
      },
      className: {
        type: 'string',
        description: 'Fully qualified class name containing the method',
      },
      oldMethodName: {
        type: 'string',
        description: 'Current method name',
      },
      newMethodName: {
        type: 'string',
        description: 'New method name',
      },
      parameterTypes: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional: parameter types to match specific overload',
      },
      dryRun: {
        type: 'boolean',
        description: 'Preview changes without applying (default: true)',
      },
    },
    required: ['projectPath', 'className', 'oldMethodName', 'newMethodName'],
  },
};

export const javaRenameFieldTool = {
  name: 'java_rename_field',
  description: 'Rename a Java field and update all references using OpenRewrite',
  inputSchema: {
    type: 'object',
    properties: {
      projectPath: {
        type: 'string',
        description: 'Path to the Java project root',
      },
      className: {
        type: 'string',
        description: 'Fully qualified class name containing the field',
      },
      oldFieldName: {
        type: 'string',
        description: 'Current field name',
      },
      newFieldName: {
        type: 'string',
        description: 'New field name',
      },
      dryRun: {
        type: 'boolean',
        description: 'Preview changes without applying (default: true)',
      },
    },
    required: ['projectPath', 'className', 'oldFieldName', 'newFieldName'],
  },
};
