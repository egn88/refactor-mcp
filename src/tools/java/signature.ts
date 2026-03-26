import { z } from 'zod';
import { readFileSync, writeFileSync } from 'fs';
import { Config } from '../../config.js';
import { OpenRewriteClient } from '../../engines/openrewrite/client.js';
import {
  buildAddMethodParameterRecipe,
  buildDeleteMethodArgumentRecipe,
  buildReorderMethodArgumentsRecipe,
  buildChangeMethodSignatureRecipe,
  buildUpdateCallSitesRecipe,
  buildAddNullMethodArgumentRecipe,
  createMethodPattern,
  ParameterToAdd,
  CallSiteParameterToAdd,
} from '../../engines/openrewrite/recipe-builder.js';
import { formatRefactoringResult } from '../../utils/diff-utils.js';
import { validateFullyQualifiedClassName, validateJavaIdentifier } from '../../utils/validation.js';
import {
  detectJavaRecord,
  addRecordComponent,
  removeRecordComponent,
  reorderRecordComponents,
  RecordInfo,
} from '../../utils/record-utils.js';

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
  javaVersion: z.string().optional().describe('Java version to use (e.g., "17.0.16-amzn", "21.0.8-tem")'),
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
  javaVersion: z.string().optional().describe('Java version to use (e.g., "17.0.16-amzn", "21.0.8-tem")'),
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
  javaVersion: z.string().optional().describe('Java version to use (e.g., "17.0.16-amzn", "21.0.8-tem")'),
});

export type JavaReorderParametersParams = z.infer<typeof javaReorderParametersSchema>;

// Change Method Signature Schema (batch operations)
const parameterToAddSchema = z.object({
  type: z.string().describe('Type of the parameter (e.g., "String", "int", "List<String>")'),
  name: z.string().describe('Name of the parameter'),
  index: z.number().int().min(0).optional().describe('Position to insert parameter (0-indexed). Defaults to end.'),
});

export const javaChangeMethodSignatureSchema = z.object({
  projectPath: z.string().describe('Path to the Java project root'),
  className: z.string().describe('Fully qualified class name containing the method'),
  methodName: z.string().describe('Method name'),
  existingParameterTypes: z.array(z.string()).optional().describe('Existing parameter types to match specific overload'),
  parametersToAdd: z.array(parameterToAddSchema).optional().describe('Parameters to add to the method'),
  parameterIndicesToRemove: z.array(z.number().int().min(0)).optional().describe('Indices of parameters to remove (0-indexed, from original signature)'),
  newParameterOrder: z.array(z.string()).optional().describe('Final parameter order by name (for reordering after add/remove)'),
  dryRun: z.boolean().default(true).describe('Preview changes without applying (default: true)'),
  javaVersion: z.string().optional().describe('Java version to use (e.g., "17.0.16-amzn", "21.0.8-tem")'),
});

export type JavaChangeMethodSignatureParams = z.infer<typeof javaChangeMethodSignatureSchema>;

/**
 * Check if the method name indicates a constructor call on a record
 */
function isRecordConstructorMethod(methodName: string, recordInfo: RecordInfo): boolean {
  if (!recordInfo.isRecord) return false;
  // Constructor methods are typically '<init>' or the class name itself
  return methodName === '<init>' || methodName === recordInfo.className;
}

/**
 * Generate a unified diff between original and modified content
 */
function generateSimpleDiff(filePath: string, original: string, modified: string): string {
  const originalLines = original.split('\n');
  const modifiedLines = modified.split('\n');

  const diffLines: string[] = [`--- a/${filePath}`, `+++ b/${filePath}`];

  // Find first differing line
  let startLine = 0;
  while (startLine < originalLines.length && startLine < modifiedLines.length &&
         originalLines[startLine] === modifiedLines[startLine]) {
    startLine++;
  }

  // Find last differing line from end
  let endOriginal = originalLines.length - 1;
  let endModified = modifiedLines.length - 1;
  while (endOriginal > startLine && endModified > startLine &&
         originalLines[endOriginal] === modifiedLines[endModified]) {
    endOriginal--;
    endModified--;
  }

  // Add context
  const contextStart = Math.max(0, startLine - 3);
  const contextEndOrig = Math.min(originalLines.length - 1, endOriginal + 3);
  const contextEndMod = Math.min(modifiedLines.length - 1, endModified + 3);

  diffLines.push(`@@ -${contextStart + 1},${contextEndOrig - contextStart + 1} +${contextStart + 1},${contextEndMod - contextStart + 1} @@`);

  // Add context before
  for (let i = contextStart; i < startLine; i++) {
    diffLines.push(` ${originalLines[i]}`);
  }

  // Add removed lines
  for (let i = startLine; i <= endOriginal; i++) {
    diffLines.push(`-${originalLines[i]}`);
  }

  // Add added lines
  for (let i = startLine; i <= endModified; i++) {
    diffLines.push(`+${modifiedLines[i]}`);
  }

  // Add context after
  for (let i = endOriginal + 1; i <= contextEndOrig; i++) {
    diffLines.push(` ${originalLines[i]}`);
  }

  return diffLines.join('\n');
}

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
    // Check if target is a Java record
    const recordInfo = await detectJavaRecord(params.projectPath, params.className);

    if (isRecordConstructorMethod(params.methodName, recordInfo)) {
      // Handle record component addition
      return await handleRecordAddComponent(params, recordInfo);
    }

    // Standard method parameter addition
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
      params.dryRun,
      params.javaVersion
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

/**
 * Handle adding a component to a Java record
 */
async function handleRecordAddComponent(
  params: JavaAddParameterParams,
  recordInfo: RecordInfo
): Promise<string> {
  if (!recordInfo.filePath) {
    return formatRefactoringResult({
      success: false,
      message: `Could not find source file for record ${params.className}`,
      filesChanged: 0,
    });
  }

  try {
    // Read the record source file
    const sourceContent = readFileSync(recordInfo.filePath, 'utf-8');

    // Prepare the record modification (but don't apply yet)
    const result = addRecordComponent(
      sourceContent,
      params.parameterType,
      params.parameterName,
      params.parameterIndex
    );

    if (!result.success) {
      return formatRefactoringResult({
        success: false,
        message: result.error || 'Failed to add record component',
        filesChanged: 0,
      });
    }

    // Generate diff for preview
    const diff = generateSimpleDiff(recordInfo.filePath, sourceContent, result.modifiedContent!);

    // Calculate the argument index for call sites
    // If no index specified, add at the end (after existing components)
    const argumentIndex = params.parameterIndex !== undefined
      ? params.parameterIndex
      : (recordInfo.components?.length || 0);

    // Create the method pattern using ORIGINAL components (before modification)
    // This is critical: OpenRewrite needs to match the OLD signature to find call sites
    const methodPattern = createMethodPattern(
      params.className,
      '<constructor>',
      recordInfo.components?.map(c => c.type)
    );

    const recipe = buildAddNullMethodArgumentRecipe(
      methodPattern,
      argumentIndex,
      params.parameterType,
      params.parameterName
    );

    const client = new OpenRewriteClient({} as Config);

    if (params.dryRun) {
      // Preview mode: show both record modification and call-site updates
      let callSiteDiff = '';
      let callSiteWarning = '';
      try {
        const orResult = await client.runRecipeWithBuildTool(
          params.projectPath,
          recipe,
          true, // dry run
          params.javaVersion
        );
        if (orResult.diff) {
          callSiteDiff = '\n\n--- Call site updates (via OpenRewrite) ---\n' + orResult.diff;
        }
        if (!orResult.success) {
          callSiteWarning = `\n\nWarning: OpenRewrite reported issues: ${orResult.message}`;
        }
      } catch (error) {
        callSiteWarning = `\n\nWarning: OpenRewrite failed to preview call-site updates: ${error instanceof Error ? error.message : 'Unknown error'}`;
      }

      return formatRefactoringResult({
        success: true,
        message: `Dry run: would add component '${params.parameterName}: ${params.parameterType}' to record '${recordInfo.className}'`,
        filesChanged: 1,
        diff: diff + callSiteDiff + callSiteWarning,
      });
    }

    // IMPORTANT: Run OpenRewrite FIRST to update call sites (before modifying record declaration)
    // This ensures OpenRewrite can compile the project and find all call sites
    let totalFilesChanged = 0;
    let callSiteWarning = '';
    try {
      const callSiteResult = await client.runRecipeWithBuildTool(
        params.projectPath,
        recipe,
        false, // apply changes
        params.javaVersion
      );
      if (callSiteResult.filesChanged) {
        totalFilesChanged += callSiteResult.filesChanged;
      }
      if (!callSiteResult.success) {
        callSiteWarning = `. Warning: OpenRewrite reported issues updating call sites: ${callSiteResult.message}`;
      }
    } catch (error) {
      // Report the error but continue with record modification
      callSiteWarning = `. Warning: OpenRewrite failed to update call sites: ${error instanceof Error ? error.message : 'Unknown error'}. Manual updates may be required.`;
    }

    // NOW apply the record declaration change (after call sites are updated)
    writeFileSync(recordInfo.filePath, result.modifiedContent!, 'utf-8');
    totalFilesChanged += 1;

    return formatRefactoringResult({
      success: true,
      message: `Added component '${params.parameterName}: ${params.parameterType}' to record '${recordInfo.className}'${callSiteWarning}`,
      filesChanged: totalFilesChanged,
      diff: diff,
    });
  } catch (error) {
    return formatRefactoringResult({
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error modifying record',
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
    // Check if target is a Java record
    const recordInfo = await detectJavaRecord(params.projectPath, params.className);

    if (isRecordConstructorMethod(params.methodName, recordInfo)) {
      // Handle record component removal
      return await handleRecordRemoveComponent(params, recordInfo);
    }

    // Standard method parameter removal
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
      params.dryRun,
      params.javaVersion
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

/**
 * Handle removing a component from a Java record
 */
async function handleRecordRemoveComponent(
  params: JavaRemoveParameterParams,
  recordInfo: RecordInfo
): Promise<string> {
  if (!recordInfo.filePath) {
    return formatRefactoringResult({
      success: false,
      message: `Could not find source file for record ${params.className}`,
      filesChanged: 0,
    });
  }

  try {
    // Read the record source file
    const sourceContent = readFileSync(recordInfo.filePath, 'utf-8');

    // Prepare the record modification (but don't apply yet)
    const result = removeRecordComponent(sourceContent, params.parameterIndex);

    if (!result.success) {
      return formatRefactoringResult({
        success: false,
        message: result.error || 'Failed to remove record component',
        filesChanged: 0,
      });
    }

    // Generate diff for preview
    const diff = generateSimpleDiff(recordInfo.filePath, sourceContent, result.modifiedContent!);
    const componentName = recordInfo.components?.[params.parameterIndex]?.name || `index ${params.parameterIndex}`;

    // Create the method pattern using ORIGINAL components (before modification)
    const methodPattern = createMethodPattern(
      params.className,
      '<constructor>',
      recordInfo.components?.map(c => c.type)
    );

    const recipe = buildDeleteMethodArgumentRecipe(methodPattern, params.parameterIndex);
    const client = new OpenRewriteClient({} as Config);

    if (params.dryRun) {
      // Preview mode
      let callSiteDiff = '';
      let callSiteWarning = '';
      try {
        const orResult = await client.runRecipeWithBuildTool(
          params.projectPath,
          recipe,
          true,
          params.javaVersion
        );
        if (orResult.diff) {
          callSiteDiff = '\n\n--- Call site updates (via OpenRewrite) ---\n' + orResult.diff;
        }
        if (!orResult.success) {
          callSiteWarning = `\n\nWarning: OpenRewrite reported issues: ${orResult.message}`;
        }
      } catch (error) {
        callSiteWarning = `\n\nWarning: OpenRewrite failed to preview call-site updates: ${error instanceof Error ? error.message : 'Unknown error'}`;
      }

      return formatRefactoringResult({
        success: true,
        message: `Dry run: would remove component '${componentName}' from record '${recordInfo.className}'`,
        filesChanged: 1,
        diff: diff + callSiteDiff + callSiteWarning,
      });
    }

    // IMPORTANT: Run OpenRewrite FIRST to update call sites
    let totalFilesChanged = 0;
    let callSiteWarning = '';
    try {
      const callSiteResult = await client.runRecipeWithBuildTool(
        params.projectPath,
        recipe,
        false,
        params.javaVersion
      );
      if (callSiteResult.filesChanged) {
        totalFilesChanged += callSiteResult.filesChanged;
      }
      if (!callSiteResult.success) {
        callSiteWarning = `. Warning: OpenRewrite reported issues updating call sites: ${callSiteResult.message}`;
      }
    } catch (error) {
      callSiteWarning = `. Warning: OpenRewrite failed to update call sites: ${error instanceof Error ? error.message : 'Unknown error'}. Manual updates may be required.`;
    }

    // NOW apply the record declaration change
    writeFileSync(recordInfo.filePath, result.modifiedContent!, 'utf-8');
    totalFilesChanged += 1;

    return formatRefactoringResult({
      success: true,
      message: `Removed component '${componentName}' from record '${recordInfo.className}'${callSiteWarning}`,
      filesChanged: totalFilesChanged,
      diff: diff,
    });
  } catch (error) {
    return formatRefactoringResult({
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error modifying record',
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
    // Check if target is a Java record
    const recordInfo = await detectJavaRecord(params.projectPath, params.className);

    if (isRecordConstructorMethod(params.methodName, recordInfo)) {
      // Handle record component reordering
      return await handleRecordReorderComponents(params, recordInfo);
    }

    // Standard method parameter reordering
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
      params.dryRun,
      params.javaVersion
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

/**
 * Handle reordering components in a Java record
 */
async function handleRecordReorderComponents(
  params: JavaReorderParametersParams,
  recordInfo: RecordInfo
): Promise<string> {
  if (!recordInfo.filePath) {
    return formatRefactoringResult({
      success: false,
      message: `Could not find source file for record ${params.className}`,
      filesChanged: 0,
    });
  }

  try {
    // Read the record source file
    const sourceContent = readFileSync(recordInfo.filePath, 'utf-8');

    // Prepare the record modification (but don't apply yet)
    const result = reorderRecordComponents(sourceContent, params.newParameterOrder);

    if (!result.success) {
      return formatRefactoringResult({
        success: false,
        message: result.error || 'Failed to reorder record components',
        filesChanged: 0,
      });
    }

    // Generate diff for preview
    const diff = generateSimpleDiff(recordInfo.filePath, sourceContent, result.modifiedContent!);

    // Create the method pattern using ORIGINAL components (before modification)
    const methodPattern = createMethodPattern(
      params.className,
      '<constructor>',
      recordInfo.components?.map(c => c.type)
    );

    const recipe = buildReorderMethodArgumentsRecipe(methodPattern, params.newParameterOrder);
    const client = new OpenRewriteClient({} as Config);

    if (params.dryRun) {
      // Preview mode
      let callSiteDiff = '';
      let callSiteWarning = '';
      try {
        const orResult = await client.runRecipeWithBuildTool(
          params.projectPath,
          recipe,
          true,
          params.javaVersion
        );
        if (orResult.diff) {
          callSiteDiff = '\n\n--- Call site updates (via OpenRewrite) ---\n' + orResult.diff;
        }
        if (!orResult.success) {
          callSiteWarning = `\n\nWarning: OpenRewrite reported issues: ${orResult.message}`;
        }
      } catch (error) {
        callSiteWarning = `\n\nWarning: OpenRewrite failed to preview call-site updates: ${error instanceof Error ? error.message : 'Unknown error'}`;
      }

      return formatRefactoringResult({
        success: true,
        message: `Dry run: would reorder components in record '${recordInfo.className}'`,
        filesChanged: 1,
        diff: diff + callSiteDiff + callSiteWarning,
      });
    }

    // IMPORTANT: Run OpenRewrite FIRST to update call sites
    let totalFilesChanged = 0;
    let callSiteWarning = '';
    try {
      const callSiteResult = await client.runRecipeWithBuildTool(
        params.projectPath,
        recipe,
        false,
        params.javaVersion
      );
      if (callSiteResult.filesChanged) {
        totalFilesChanged += callSiteResult.filesChanged;
      }
      if (!callSiteResult.success) {
        callSiteWarning = `. Warning: OpenRewrite reported issues updating call sites: ${callSiteResult.message}`;
      }
    } catch (error) {
      callSiteWarning = `. Warning: OpenRewrite failed to update call sites: ${error instanceof Error ? error.message : 'Unknown error'}. Manual updates may be required.`;
    }

    // NOW apply the record declaration change
    writeFileSync(recordInfo.filePath, result.modifiedContent!, 'utf-8');
    totalFilesChanged += 1;

    return formatRefactoringResult({
      success: true,
      message: `Reordered components in record '${recordInfo.className}'${callSiteWarning}`,
      filesChanged: totalFilesChanged,
      diff: diff,
    });
  } catch (error) {
    return formatRefactoringResult({
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error modifying record',
      filesChanged: 0,
    });
  }
}

export async function javaChangeMethodSignature(config: Config, params: JavaChangeMethodSignatureParams): Promise<string> {
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

  // Validate parameters to add
  const paramsToAdd = params.parametersToAdd || [];
  for (const param of paramsToAdd) {
    const paramValidation = validateJavaIdentifier(param.name);
    if (!paramValidation.valid) {
      return formatRefactoringResult({
        success: false,
        message: paramValidation.error || `Invalid parameter name: ${param.name}`,
        filesChanged: 0,
      });
    }
  }

  // Validate new parameter order names if provided
  if (params.newParameterOrder) {
    for (const paramName of params.newParameterOrder) {
      const paramValidation = validateJavaIdentifier(paramName);
      if (!paramValidation.valid) {
        return formatRefactoringResult({
          success: false,
          message: paramValidation.error || `Invalid parameter name in newParameterOrder: ${paramName}`,
          filesChanged: 0,
        });
      }
    }
  }

  // Validate that we have at least one operation
  const hasOperations = (paramsToAdd.length > 0) ||
                        (params.parameterIndicesToRemove && params.parameterIndicesToRemove.length > 0) ||
                        (params.newParameterOrder && params.newParameterOrder.length > 0);

  if (!hasOperations) {
    return formatRefactoringResult({
      success: false,
      message: 'At least one operation must be specified: parametersToAdd, parameterIndicesToRemove, or newParameterOrder',
      filesChanged: 0,
    });
  }

  try {
    // Check if target is a Java record
    const recordInfo = await detectJavaRecord(params.projectPath, params.className);

    if (isRecordConstructorMethod(params.methodName, recordInfo)) {
      // Handle record signature change
      return await handleRecordChangeSignature(params, recordInfo, paramsToAdd);
    }

    // Standard method signature change
    const client = new OpenRewriteClient(config);

    const methodPattern = createMethodPattern(
      params.className,
      params.methodName,
      params.existingParameterTypes
    );

    // Convert parametersToAdd to the format expected by the recipe builder
    const paramsForRecipe: ParameterToAdd[] = paramsToAdd.map(p => ({
      type: p.type,
      name: p.name,
      index: p.index,
    }));

    const recipe = buildChangeMethodSignatureRecipe(
      methodPattern,
      paramsForRecipe,
      params.parameterIndicesToRemove || [],
      params.newParameterOrder
    );

    const result = await client.runRecipeWithBuildTool(
      params.projectPath,
      recipe,
      params.dryRun,
      params.javaVersion
    );

    // Build operation summary
    const operations: string[] = [];
    if (params.parameterIndicesToRemove && params.parameterIndicesToRemove.length > 0) {
      operations.push(`remove ${params.parameterIndicesToRemove.length} parameter(s)`);
    }
    if (paramsToAdd.length > 0) {
      operations.push(`add ${paramsToAdd.length} parameter(s)`);
    }
    if (params.newParameterOrder && params.newParameterOrder.length > 0) {
      operations.push('reorder parameters');
    }
    const operationSummary = operations.join(', ');

    return formatRefactoringResult({
      success: result.success,
      message: result.success
        ? (params.dryRun
            ? `Dry run: would ${operationSummary} in '${params.methodName}'`
            : `Changed method signature: ${operationSummary} in '${params.methodName}'`)
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

/**
 * Handle changing signature of a Java record (multiple operations)
 */
async function handleRecordChangeSignature(
  params: JavaChangeMethodSignatureParams,
  recordInfo: RecordInfo,
  paramsToAdd: Array<{ type: string; name: string; index?: number }>
): Promise<string> {
  if (!recordInfo.filePath) {
    return formatRefactoringResult({
      success: false,
      message: `Could not find source file for record ${params.className}`,
      filesChanged: 0,
    });
  }

  try {
    // Read the record source file
    let sourceContent = readFileSync(recordInfo.filePath, 'utf-8');
    const originalContent = sourceContent;

    // Apply operations in order: remove, add, reorder
    // Sort removal indices from highest to lowest to avoid index shifting
    const removalIndices = params.parameterIndicesToRemove
      ? [...params.parameterIndicesToRemove].sort((a, b) => b - a)
      : [];

    // Prepare record modifications (simulate to validate, but don't apply yet)
    let modifiedContent = sourceContent;

    // Remove components (highest index first)
    for (const index of removalIndices) {
      const result = removeRecordComponent(modifiedContent, index);
      if (!result.success) {
        return formatRefactoringResult({
          success: false,
          message: result.error || `Failed to remove component at index ${index}`,
          filesChanged: 0,
        });
      }
      modifiedContent = result.modifiedContent!;
    }

    // Add components
    for (const param of paramsToAdd) {
      const result = addRecordComponent(
        modifiedContent,
        param.type,
        param.name,
        param.index
      );
      if (!result.success) {
        return formatRefactoringResult({
          success: false,
          message: result.error || `Failed to add component ${param.name}`,
          filesChanged: 0,
        });
      }
      modifiedContent = result.modifiedContent!;
    }

    // Reorder components
    if (params.newParameterOrder && params.newParameterOrder.length > 0) {
      const result = reorderRecordComponents(modifiedContent, params.newParameterOrder);
      if (!result.success) {
        return formatRefactoringResult({
          success: false,
          message: result.error || 'Failed to reorder components',
          filesChanged: 0,
        });
      }
      modifiedContent = result.modifiedContent!;
    }

    // Generate diff for preview
    const diff = generateSimpleDiff(recordInfo.filePath, originalContent, modifiedContent);

    // Build operation summary
    const operations: string[] = [];
    if (removalIndices.length > 0) {
      operations.push(`remove ${removalIndices.length} component(s)`);
    }
    if (paramsToAdd.length > 0) {
      operations.push(`add ${paramsToAdd.length} component(s)`);
    }
    if (params.newParameterOrder && params.newParameterOrder.length > 0) {
      operations.push('reorder components');
    }
    const operationSummary = operations.join(', ');

    // Create the method pattern using ORIGINAL components (before modification)
    const methodPattern = createMethodPattern(
      params.className,
      '<constructor>',
      recordInfo.components?.map(c => c.type)
    );

    // Convert parameters to CallSiteParameterToAdd format
    const existingCount = recordInfo.components?.length || 0;
    const callSiteParams: CallSiteParameterToAdd[] = paramsToAdd.map((p, i) => ({
      type: p.type,
      name: p.name,
      index: p.index !== undefined ? p.index : existingCount + i,
    }));

    // Use buildUpdateCallSitesRecipe which uses AddNullMethodArgument for call sites
    const recipe = buildUpdateCallSitesRecipe(
      methodPattern,
      callSiteParams,
      params.parameterIndicesToRemove || [],
      params.newParameterOrder
    );

    const client = new OpenRewriteClient({} as Config);

    if (params.dryRun) {
      // Preview mode
      let callSiteDiff = '';
      let callSiteWarning = '';
      try {
        const orResult = await client.runRecipeWithBuildTool(
          params.projectPath,
          recipe,
          true,
          params.javaVersion
        );
        if (orResult.diff) {
          callSiteDiff = '\n\n--- Call site updates (via OpenRewrite) ---\n' + orResult.diff;
        }
        if (!orResult.success) {
          callSiteWarning = `\n\nWarning: OpenRewrite reported issues: ${orResult.message}`;
        }
      } catch (error) {
        callSiteWarning = `\n\nWarning: OpenRewrite failed to preview call-site updates: ${error instanceof Error ? error.message : 'Unknown error'}`;
      }

      return formatRefactoringResult({
        success: true,
        message: `Dry run: would ${operationSummary} in record '${recordInfo.className}'`,
        filesChanged: 1,
        diff: diff + callSiteDiff + callSiteWarning,
      });
    }

    // IMPORTANT: Run OpenRewrite FIRST to update call sites
    let totalFilesChanged = 0;
    let callSiteWarning = '';
    try {
      const callSiteResult = await client.runRecipeWithBuildTool(
        params.projectPath,
        recipe,
        false,
        params.javaVersion
      );
      if (callSiteResult.filesChanged) {
        totalFilesChanged += callSiteResult.filesChanged;
      }
      if (!callSiteResult.success) {
        callSiteWarning = `. Warning: OpenRewrite reported issues updating call sites: ${callSiteResult.message}`;
      }
    } catch (error) {
      callSiteWarning = `. Warning: OpenRewrite failed to update call sites: ${error instanceof Error ? error.message : 'Unknown error'}. Manual updates may be required.`;
    }

    // NOW apply the record declaration change
    writeFileSync(recordInfo.filePath, modifiedContent, 'utf-8');
    totalFilesChanged += 1;

    return formatRefactoringResult({
      success: true,
      message: `Changed record signature: ${operationSummary} in '${recordInfo.className}'${callSiteWarning}`,
      filesChanged: totalFilesChanged,
      diff: diff,
    });
  } catch (error) {
    return formatRefactoringResult({
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error modifying record',
      filesChanged: 0,
    });
  }
}

// Tool definitions for MCP
export const javaAddParameterTool = {
  name: 'java_add_parameter',
  description: 'Add a new parameter to a Java method or record constructor and update all call sites. For Java records, use methodName "<init>" or the class name to target the constructor - the tool auto-detects records and updates both the record declaration AND all "new RecordName(...)" call sites (adding null as the new argument value).',
  inputSchema: {
    type: 'object',
    properties: {
      projectPath: {
        type: 'string',
        description: 'Path to the Java project root',
      },
      className: {
        type: 'string',
        description: 'Fully qualified class name containing the method or record',
      },
      methodName: {
        type: 'string',
        description: 'Method name. For record constructors, use "<init>" or the class name (e.g., "MyRecord")',
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
      javaVersion: {
        type: 'string',
        description: 'Java version to use (e.g., "17.0.16-amzn", "21.0.8-tem")',
      },
    },
    required: ['projectPath', 'className', 'methodName', 'parameterType', 'parameterName'],
  },
};

export const javaRemoveParameterTool = {
  name: 'java_remove_parameter',
  description: 'Remove a parameter from a Java method or record constructor and update all call sites. For Java records, use methodName "<init>" or the class name - the tool auto-detects records and updates both the record declaration AND all "new RecordName(...)" call sites.',
  inputSchema: {
    type: 'object',
    properties: {
      projectPath: {
        type: 'string',
        description: 'Path to the Java project root',
      },
      className: {
        type: 'string',
        description: 'Fully qualified class name containing the method or record',
      },
      methodName: {
        type: 'string',
        description: 'Method name. For record constructors, use "<init>" or the class name (e.g., "MyRecord")',
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
      javaVersion: {
        type: 'string',
        description: 'Java version to use (e.g., "17.0.16-amzn", "21.0.8-tem")',
      },
    },
    required: ['projectPath', 'className', 'methodName', 'parameterIndex'],
  },
};

export const javaReorderParametersTool = {
  name: 'java_reorder_parameters',
  description: 'Reorder parameters in a Java method or record constructor and update all call sites. For Java records, use methodName "<init>" or the class name - the tool auto-detects records and updates both the record declaration AND all "new RecordName(...)" call sites.',
  inputSchema: {
    type: 'object',
    properties: {
      projectPath: {
        type: 'string',
        description: 'Path to the Java project root',
      },
      className: {
        type: 'string',
        description: 'Fully qualified class name containing the method or record',
      },
      methodName: {
        type: 'string',
        description: 'Method name. For record constructors, use "<init>" or the class name (e.g., "MyRecord")',
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
      javaVersion: {
        type: 'string',
        description: 'Java version to use (e.g., "17.0.16-amzn", "21.0.8-tem")',
      },
    },
    required: ['projectPath', 'className', 'methodName', 'newParameterOrder'],
  },
};

export const javaChangeMethodSignatureTool = {
  name: 'java_change_method_signature',
  description: 'Change a Java method or record constructor signature with multiple parameter operations (add, remove, reorder) in a single refactoring. More efficient than calling individual tools when making multiple changes. For Java records, use methodName "<init>" or the class name - the tool auto-detects records and updates both the record declaration AND all "new RecordName(...)" call sites (adding null for new parameters).',
  inputSchema: {
    type: 'object',
    properties: {
      projectPath: {
        type: 'string',
        description: 'Path to the Java project root',
      },
      className: {
        type: 'string',
        description: 'Fully qualified class name containing the method or record',
      },
      methodName: {
        type: 'string',
        description: 'Method name. For record constructors, use "<init>" or the class name (e.g., "MyRecord")',
      },
      existingParameterTypes: {
        type: 'array',
        items: { type: 'string' },
        description: 'Existing parameter types to match specific overload',
      },
      parametersToAdd: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', description: 'Type of the parameter (e.g., "String", "int", "List<String>")' },
            name: { type: 'string', description: 'Name of the parameter' },
            index: { type: 'number', description: 'Position to insert parameter (0-indexed). Defaults to end.' },
          },
          required: ['type', 'name'],
        },
        description: 'Parameters to add to the method',
      },
      parameterIndicesToRemove: {
        type: 'array',
        items: { type: 'number' },
        description: 'Indices of parameters to remove (0-indexed, from original signature). Processed before additions.',
      },
      newParameterOrder: {
        type: 'array',
        items: { type: 'string' },
        description: 'Final parameter order by name. Applied after additions and removals.',
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
    required: ['projectPath', 'className', 'methodName'],
  },
};
