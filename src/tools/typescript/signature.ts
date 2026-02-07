import { z } from 'zod';
import { Node, FunctionDeclaration, MethodDeclaration, ArrowFunction, FunctionExpression, ParameterDeclaration } from 'ts-morph';
import { TsMorphClientWithTracking } from '../../engines/ts-morph/client.js';
import { generateMultiFileDiff, formatRefactoringResult } from '../../utils/diff-utils.js';
import { validateTypeScriptIdentifier } from '../../utils/validation.js';

// Add Parameter Schema
export const typescriptAddParameterSchema = z.object({
  tsconfigPath: z.string().describe('Path to tsconfig.json'),
  functionName: z.string().describe('Name of the function/method'),
  parameterName: z.string().describe('Name of the new parameter'),
  parameterType: z.string().describe('Type of the new parameter'),
  defaultValue: z.string().optional().describe('Optional default value for the parameter'),
  position: z.number().int().min(0).optional().describe('Position to insert parameter (0-indexed, default: end)'),
  filePath: z.string().optional().describe('Optional: specific file to search in'),
  dryRun: z.boolean().default(true).describe('Preview changes without applying (default: true)'),
});

export type TypescriptAddParameterParams = z.infer<typeof typescriptAddParameterSchema>;

// Remove Parameter Schema
export const typescriptRemoveParameterSchema = z.object({
  tsconfigPath: z.string().describe('Path to tsconfig.json'),
  functionName: z.string().describe('Name of the function/method'),
  parameterName: z.string().describe('Name of the parameter to remove'),
  filePath: z.string().optional().describe('Optional: specific file to search in'),
  dryRun: z.boolean().default(true).describe('Preview changes without applying (default: true)'),
});

export type TypescriptRemoveParameterParams = z.infer<typeof typescriptRemoveParameterSchema>;

type FunctionLike = FunctionDeclaration | MethodDeclaration | ArrowFunction | FunctionExpression;

export async function typescriptAddParameter(params: TypescriptAddParameterParams): Promise<string> {
  // Validate parameter name
  const validation = validateTypeScriptIdentifier(params.parameterName);
  if (!validation.valid) {
    return formatRefactoringResult({
      success: false,
      message: validation.error || 'Invalid parameter name',
      filesChanged: 0,
    });
  }

  try {
    const client = new TsMorphClientWithTracking(params.tsconfigPath);
    const project = client.getProject();

    // Find the function
    const func = findFunction(client, params.functionName, params.filePath);
    if (!func) {
      return formatRefactoringResult({
        success: false,
        message: `Function not found: ${params.functionName}`,
        filesChanged: 0,
      });
    }

    // Check if parameter already exists
    const existingParams = func.getParameters();
    if (existingParams.some((p) => p.getName() === params.parameterName)) {
      return formatRefactoringResult({
        success: false,
        message: `Parameter '${params.parameterName}' already exists`,
        filesChanged: 0,
      });
    }

    // Determine position
    const position = params.position !== undefined ? params.position : existingParams.length;

    // Add the parameter
    func.insertParameter(position, {
      name: params.parameterName,
      type: params.parameterType,
      initializer: params.defaultValue,
    });

    // Update all call sites if no default value
    if (!params.defaultValue) {
      updateCallSites(project, func, params.parameterName, position, 'add');
    }

    // Collect changes
    const changes = client.collectChanges();

    if (changes.length === 0) {
      return formatRefactoringResult({
        success: true,
        message: 'No changes needed',
        filesChanged: 0,
      });
    }

    // Generate diff
    const diff = generateMultiFileDiff(changes);

    if (!params.dryRun) {
      await client.saveChanges();
    }

    return formatRefactoringResult({
      success: true,
      message: params.dryRun
        ? `Dry run: would add parameter '${params.parameterName}' to '${params.functionName}'`
        : `Added parameter '${params.parameterName}' to '${params.functionName}'`,
      filesChanged: changes.length,
      diff,
    });
  } catch (error) {
    return formatRefactoringResult({
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error',
      filesChanged: 0,
    });
  }
}

export async function typescriptRemoveParameter(params: TypescriptRemoveParameterParams): Promise<string> {
  try {
    const client = new TsMorphClientWithTracking(params.tsconfigPath);
    const project = client.getProject();

    // Find the function
    const func = findFunction(client, params.functionName, params.filePath);
    if (!func) {
      return formatRefactoringResult({
        success: false,
        message: `Function not found: ${params.functionName}`,
        filesChanged: 0,
      });
    }

    // Find the parameter
    const existingParams = func.getParameters();
    const paramIndex = existingParams.findIndex((p) => p.getName() === params.parameterName);

    if (paramIndex === -1) {
      return formatRefactoringResult({
        success: false,
        message: `Parameter '${params.parameterName}' not found in function '${params.functionName}'`,
        filesChanged: 0,
      });
    }

    // Update call sites first (remove the argument at the position)
    updateCallSites(project, func, params.parameterName, paramIndex, 'remove');

    // Remove the parameter
    existingParams[paramIndex].remove();

    // Collect changes
    const changes = client.collectChanges();

    if (changes.length === 0) {
      return formatRefactoringResult({
        success: true,
        message: 'No changes needed',
        filesChanged: 0,
      });
    }

    // Generate diff
    const diff = generateMultiFileDiff(changes);

    if (!params.dryRun) {
      await client.saveChanges();
    }

    return formatRefactoringResult({
      success: true,
      message: params.dryRun
        ? `Dry run: would remove parameter '${params.parameterName}' from '${params.functionName}'`
        : `Removed parameter '${params.parameterName}' from '${params.functionName}'`,
      filesChanged: changes.length,
      diff,
    });
  } catch (error) {
    return formatRefactoringResult({
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error',
      filesChanged: 0,
    });
  }
}

function findFunction(
  client: TsMorphClientWithTracking,
  functionName: string,
  filePath?: string
): FunctionLike | undefined {
  const sourceFiles = filePath
    ? [client.getSourceFileOrThrow(filePath)]
    : client.getAllSourceFiles();

  for (const sourceFile of sourceFiles) {
    // Check top-level functions
    const func = sourceFile.getFunction(functionName);
    if (func) return func;

    // Check class methods
    for (const classDecl of sourceFile.getClasses()) {
      const method = classDecl.getMethod(functionName);
      if (method) return method;
    }

    // Check arrow functions assigned to variables
    const varDecl = sourceFile.getVariableDeclaration(functionName);
    if (varDecl) {
      const initializer = varDecl.getInitializer();
      if (initializer && Node.isArrowFunction(initializer)) {
        return initializer;
      }
      if (initializer && Node.isFunctionExpression(initializer)) {
        return initializer;
      }
    }
  }

  return undefined;
}

function updateCallSites(
  project: import('ts-morph').Project,
  func: FunctionLike,
  parameterName: string,
  position: number,
  action: 'add' | 'remove'
): void {
  // Find all references to the function
  if (!Node.isReferenceFindable(func)) return;

  const references = func.findReferences();

  for (const refSymbol of references) {
    for (const ref of refSymbol.getReferences()) {
      const node = ref.getNode();
      const parent = node.getParent();

      // Check if this is a call expression
      if (parent && Node.isCallExpression(parent)) {
        const args = parent.getArguments();

        if (action === 'add') {
          // Add undefined as placeholder for the new argument
          // In a full implementation, you might prompt for the value
          if (position <= args.length) {
            parent.insertArgument(position, 'undefined');
          }
        } else if (action === 'remove') {
          // Remove the argument at the position
          if (position < args.length) {
            parent.removeArgument(position);
          }
        }
      }
    }
  }
}

// Tool definitions for MCP
export const typescriptAddParameterTool = {
  name: 'typescript_add_parameter',
  description: 'Add a new parameter to a TypeScript/JavaScript function and update all call sites',
  inputSchema: {
    type: 'object',
    properties: {
      tsconfigPath: {
        type: 'string',
        description: 'Path to tsconfig.json',
      },
      functionName: {
        type: 'string',
        description: 'Name of the function/method',
      },
      parameterName: {
        type: 'string',
        description: 'Name of the new parameter',
      },
      parameterType: {
        type: 'string',
        description: 'Type of the new parameter',
      },
      defaultValue: {
        type: 'string',
        description: 'Optional default value for the parameter',
      },
      position: {
        type: 'number',
        description: 'Position to insert parameter (0-indexed, default: end)',
      },
      filePath: {
        type: 'string',
        description: 'Optional: specific file to search in',
      },
      dryRun: {
        type: 'boolean',
        description: 'Preview changes without applying (default: true)',
      },
    },
    required: ['tsconfigPath', 'functionName', 'parameterName', 'parameterType'],
  },
};

export const typescriptRemoveParameterTool = {
  name: 'typescript_remove_parameter',
  description: 'Remove a parameter from a TypeScript/JavaScript function and update all call sites',
  inputSchema: {
    type: 'object',
    properties: {
      tsconfigPath: {
        type: 'string',
        description: 'Path to tsconfig.json',
      },
      functionName: {
        type: 'string',
        description: 'Name of the function/method',
      },
      parameterName: {
        type: 'string',
        description: 'Name of the parameter to remove',
      },
      filePath: {
        type: 'string',
        description: 'Optional: specific file to search in',
      },
      dryRun: {
        type: 'boolean',
        description: 'Preview changes without applying (default: true)',
      },
    },
    required: ['tsconfigPath', 'functionName', 'parameterName'],
  },
};
