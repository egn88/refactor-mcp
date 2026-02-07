import { z } from 'zod';
import { Config } from '../../config.js';
import { OpenRewriteClient } from '../../engines/openrewrite/client.js';
import {
  buildAddMethodParameterRecipe,
  buildDeleteMethodArgumentRecipe,
  buildReorderMethodArgumentsRecipe,
  createMethodPattern,
} from '../../engines/openrewrite/recipe-builder.js';
import { formatRefactoringResult } from '../../utils/diff-utils.js';
import { validateFullyQualifiedClassName, validateJavaIdentifier } from '../../utils/validation.js';

// Add Parameter Schema
export const javaAddParameterSchema = z.object({
  projectPath: z.string().describe('Path to the Java project root'),
  className: z.string().describe('Fully qualified class name containing the method'),
  methodName: z.string().describe('Method name'),
  parameterType: z.string().describe('Type of the new parameter'),
  parameterName: z.string().describe('Name of the new parameter'),
  parameterIndex: z.number().int().min(0).optional().describe('Position to insert parameter (0-indexed)'),
  existingParameterTypes: z.array(z.string()).optional().describe('Existing parameter types to match specific overload'),
  dryRun: z.boolean().default(true).describe('Preview changes without applying (default: true)'),
});

export type JavaAddParameterParams = z.infer<typeof javaAddParameterSchema>;

// Remove Parameter Schema
export const javaRemoveParameterSchema = z.object({
  projectPath: z.string().describe('Path to the Java project root'),
  className: z.string().describe('Fully qualified class name containing the method'),
  methodName: z.string().describe('Method name'),
  parameterIndex: z.number().int().min(0).describe('Index of parameter to remove (0-indexed)'),
  existingParameterTypes: z.array(z.string()).optional().describe('Existing parameter types to match specific overload'),
  dryRun: z.boolean().default(true).describe('Preview changes without applying (default: true)'),
});

export type JavaRemoveParameterParams = z.infer<typeof javaRemoveParameterSchema>;

// Reorder Parameters Schema
export const javaReorderParametersSchema = z.object({
  projectPath: z.string().describe('Path to the Java project root'),
  className: z.string().describe('Fully qualified class name containing the method'),
  methodName: z.string().describe('Method name'),
  newParameterOrder: z.array(z.string()).describe('New order of parameter names'),
  existingParameterTypes: z.array(z.string()).optional().describe('Existing parameter types to match specific overload'),
  dryRun: z.boolean().default(true).describe('Preview changes without applying (default: true)'),
});

export type JavaReorderParametersParams = z.infer<typeof javaReorderParametersSchema>;

export async function javaAddParameter(config: Config, params: JavaAddParameterParams): Promise<string> {
  // Validate class name
  const classValidation = validateFullyQualifiedClassName(params.className);
  if (!classValidation.valid) {
    return formatRefactoringResult({
      success: false,
      message: classValidation.error || 'Invalid class name',
      filesChanged: 0,
    });
  }

  // Validate method name
  const methodValidation = validateJavaIdentifier(params.methodName);
  if (!methodValidation.valid) {
    return formatRefactoringResult({
      success: false,
      message: methodValidation.error || 'Invalid method name',
      filesChanged: 0,
    });
  }

  // Validate parameter name
  const paramValidation = validateJavaIdentifier(params.parameterName);
  if (!paramValidation.valid) {
    return formatRefactoringResult({
      success: false,
      message: paramValidation.error || 'Invalid parameter name',
      filesChanged: 0,
    });
  }

  try {
    const client = new OpenRewriteClient(config);

    const methodPattern = createMethodPattern(
      params.className,
      params.methodName,
      params.existingParameterTypes
    );

    const recipe = buildAddMethodParameterRecipe(
      methodPattern,
      params.parameterType,
      params.parameterName,
      params.parameterIndex
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
            ? `Dry run: would add parameter '${params.parameterName}: ${params.parameterType}' to '${params.methodName}'`
            : `Added parameter '${params.parameterName}: ${params.parameterType}' to '${params.methodName}'`)
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

export async function javaRemoveParameter(config: Config, params: JavaRemoveParameterParams): Promise<string> {
  // Validate class name
  const classValidation = validateFullyQualifiedClassName(params.className);
  if (!classValidation.valid) {
    return formatRefactoringResult({
      success: false,
      message: classValidation.error || 'Invalid class name',
      filesChanged: 0,
    });
  }

  // Validate method name
  const methodValidation = validateJavaIdentifier(params.methodName);
  if (!methodValidation.valid) {
    return formatRefactoringResult({
      success: false,
      message: methodValidation.error || 'Invalid method name',
      filesChanged: 0,
    });
  }

  try {
    const client = new OpenRewriteClient(config);

    const methodPattern = createMethodPattern(
      params.className,
      params.methodName,
      params.existingParameterTypes
    );

    const recipe = buildDeleteMethodArgumentRecipe(methodPattern, params.parameterIndex);

    const result = await client.runRecipeWithBuildTool(
      params.projectPath,
      recipe,
      params.dryRun
    );

    return formatRefactoringResult({
      success: result.success,
      message: result.success
        ? (params.dryRun
            ? `Dry run: would remove parameter at index ${params.parameterIndex} from '${params.methodName}'`
            : `Removed parameter at index ${params.parameterIndex} from '${params.methodName}'`)
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

export async function javaReorderParameters(config: Config, params: JavaReorderParametersParams): Promise<string> {
  // Validate class name
  const classValidation = validateFullyQualifiedClassName(params.className);
  if (!classValidation.valid) {
    return formatRefactoringResult({
      success: false,
      message: classValidation.error || 'Invalid class name',
      filesChanged: 0,
    });
  }

  // Validate method name
  const methodValidation = validateJavaIdentifier(params.methodName);
  if (!methodValidation.valid) {
    return formatRefactoringResult({
      success: false,
      message: methodValidation.error || 'Invalid method name',
      filesChanged: 0,
    });
  }

  // Validate parameter names
  for (const paramName of params.newParameterOrder) {
    const paramValidation = validateJavaIdentifier(paramName);
    if (!paramValidation.valid) {
      return formatRefactoringResult({
        success: false,
        message: paramValidation.error || `Invalid parameter name: ${paramName}`,
        filesChanged: 0,
      });
    }
  }

  try {
    const client = new OpenRewriteClient(config);

    const methodPattern = createMethodPattern(
      params.className,
      params.methodName,
      params.existingParameterTypes
    );

    const recipe = buildReorderMethodArgumentsRecipe(
      methodPattern,
      params.newParameterOrder
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
            ? `Dry run: would reorder parameters in '${params.methodName}'`
            : `Reordered parameters in '${params.methodName}'`)
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
export const javaAddParameterTool = {
  name: 'java_add_parameter',
  description: 'Add a new parameter to a Java method and update all call sites using OpenRewrite',
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
      methodName: {
        type: 'string',
        description: 'Method name',
      },
      parameterType: {
        type: 'string',
        description: 'Type of the new parameter',
      },
      parameterName: {
        type: 'string',
        description: 'Name of the new parameter',
      },
      parameterIndex: {
        type: 'number',
        description: 'Position to insert parameter (0-indexed)',
      },
      existingParameterTypes: {
        type: 'array',
        items: { type: 'string' },
        description: 'Existing parameter types to match specific overload',
      },
      dryRun: {
        type: 'boolean',
        description: 'Preview changes without applying (default: true)',
      },
    },
    required: ['projectPath', 'className', 'methodName', 'parameterType', 'parameterName'],
  },
};

export const javaRemoveParameterTool = {
  name: 'java_remove_parameter',
  description: 'Remove a parameter from a Java method and update all call sites using OpenRewrite',
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
      methodName: {
        type: 'string',
        description: 'Method name',
      },
      parameterIndex: {
        type: 'number',
        description: 'Index of parameter to remove (0-indexed)',
      },
      existingParameterTypes: {
        type: 'array',
        items: { type: 'string' },
        description: 'Existing parameter types to match specific overload',
      },
      dryRun: {
        type: 'boolean',
        description: 'Preview changes without applying (default: true)',
      },
    },
    required: ['projectPath', 'className', 'methodName', 'parameterIndex'],
  },
};

export const javaReorderParametersTool = {
  name: 'java_reorder_parameters',
  description: 'Reorder parameters in a Java method and update all call sites using OpenRewrite',
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
      methodName: {
        type: 'string',
        description: 'Method name',
      },
      newParameterOrder: {
        type: 'array',
        items: { type: 'string' },
        description: 'New order of parameter names',
      },
      existingParameterTypes: {
        type: 'array',
        items: { type: 'string' },
        description: 'Existing parameter types to match specific overload',
      },
      dryRun: {
        type: 'boolean',
        description: 'Preview changes without applying (default: true)',
      },
    },
    required: ['projectPath', 'className', 'methodName', 'newParameterOrder'],
  },
};
