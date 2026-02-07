import { z } from 'zod';
import { Node, SyntaxKind, VariableDeclarationKind } from 'ts-morph';
import { TsMorphClientWithTracking } from '../../engines/ts-morph/client.js';
import { generateMultiFileDiff, formatRefactoringResult } from '../../utils/diff-utils.js';
import { validateTypeScriptIdentifier } from '../../utils/validation.js';

export const typescriptExtractFunctionSchema = z.object({
  tsconfigPath: z.string().describe('Path to tsconfig.json'),
  filePath: z.string().describe('Path to the file containing the code'),
  startLine: z.number().int().positive().describe('Start line of the code to extract (1-indexed)'),
  endLine: z.number().int().positive().describe('End line of the code to extract (1-indexed)'),
  functionName: z.string().describe('Name for the extracted function'),
  dryRun: z.boolean().default(true).describe('Preview changes without applying (default: true)'),
});

export type TypescriptExtractFunctionParams = z.infer<typeof typescriptExtractFunctionSchema>;

export async function typescriptExtractFunction(params: TypescriptExtractFunctionParams): Promise<string> {
  // Validate function name
  const validation = validateTypeScriptIdentifier(params.functionName);
  if (!validation.valid) {
    return formatRefactoringResult({
      success: false,
      message: validation.error || 'Invalid function name',
      filesChanged: 0,
    });
  }

  if (params.endLine < params.startLine) {
    return formatRefactoringResult({
      success: false,
      message: 'End line must be greater than or equal to start line',
      filesChanged: 0,
    });
  }

  try {
    const client = new TsMorphClientWithTracking(params.tsconfigPath);

    const sourceFile = client.getSourceFile(params.filePath);
    if (!sourceFile) {
      return formatRefactoringResult({
        success: false,
        message: `Source file not found: ${params.filePath}`,
        filesChanged: 0,
      });
    }

    const fullText = sourceFile.getFullText();
    const lines = fullText.split('\n');

    // Validate line numbers
    if (params.startLine > lines.length || params.endLine > lines.length) {
      return formatRefactoringResult({
        success: false,
        message: `Line numbers out of range. File has ${lines.length} lines.`,
        filesChanged: 0,
      });
    }

    // Extract the code (convert to 0-indexed)
    const extractedLines = lines.slice(params.startLine - 1, params.endLine);
    const extractedCode = extractedLines.join('\n');

    // Find variables used in the extracted code that are defined outside
    const usedVariables = findUsedVariables(sourceFile, params.startLine, params.endLine);

    // Find variables defined in the extracted code that are used after
    const returnedVariables = findReturnedVariables(sourceFile, params.startLine, params.endLine);

    // Build function parameters
    const parameterList = usedVariables.map((v) => `${v.name}: ${v.type}`).join(', ');

    // Build return statement
    let returnStatement = '';
    let returnType = 'void';
    if (returnedVariables.length === 1) {
      returnStatement = `\n  return ${returnedVariables[0].name};`;
      returnType = returnedVariables[0].type;
    } else if (returnedVariables.length > 1) {
      const returnObj = returnedVariables.map((v) => v.name).join(', ');
      returnStatement = `\n  return { ${returnObj} };`;
      returnType = `{ ${returnedVariables.map((v) => `${v.name}: ${v.type}`).join('; ')} }`;
    }

    // Build the new function
    const indentedCode = extractedLines.map((line) => '  ' + line.trimStart()).join('\n');
    const newFunction = `function ${params.functionName}(${parameterList}): ${returnType} {\n${indentedCode}${returnStatement}\n}\n\n`;

    // Build the function call
    const args = usedVariables.map((v) => v.name).join(', ');
    let functionCall: string;
    if (returnedVariables.length === 0) {
      functionCall = `${params.functionName}(${args});`;
    } else if (returnedVariables.length === 1) {
      functionCall = `const ${returnedVariables[0].name} = ${params.functionName}(${args});`;
    } else {
      const destructure = returnedVariables.map((v) => v.name).join(', ');
      functionCall = `const { ${destructure} } = ${params.functionName}(${args});`;
    }

    // Find the position to insert the new function (before the containing function/class)
    const containingNode = findContainingFunctionOrClass(sourceFile, params.startLine);
    const insertPosition = containingNode
      ? containingNode.getStart()
      : sourceFile.getStatements()[0]?.getStart() || 0;

    // Calculate the position to replace the extracted code
    const startPos = sourceFile.compilerNode.getPositionOfLineAndCharacter(params.startLine - 1, 0);
    const endPos = params.endLine < lines.length
      ? sourceFile.compilerNode.getPositionOfLineAndCharacter(params.endLine, 0)
      : fullText.length;

    // Apply the transformation
    // First, insert the new function
    sourceFile.insertText(insertPosition, newFunction);

    // Then replace the extracted code with the function call
    // Need to recalculate positions after insertion
    const adjustedStartPos = startPos + newFunction.length;
    const adjustedEndPos = endPos + newFunction.length;

    sourceFile.replaceText([adjustedStartPos, adjustedEndPos], functionCall + '\n');

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
        ? `Dry run: would extract function '${params.functionName}'`
        : `Extracted function '${params.functionName}'`,
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

interface VariableInfo {
  name: string;
  type: string;
}

function findUsedVariables(
  sourceFile: import('ts-morph').SourceFile,
  startLine: number,
  endLine: number
): VariableInfo[] {
  // This is a simplified implementation
  // A full implementation would analyze the AST more thoroughly
  const variables: VariableInfo[] = [];
  const seen = new Set<string>();

  // Find all identifiers in the range that reference variables defined outside
  sourceFile.forEachDescendant((node) => {
    const line = node.getStartLineNumber();
    if (line >= startLine && line <= endLine && Node.isIdentifier(node)) {
      const name = node.getText();

      // Skip if already processed
      if (seen.has(name)) return;

      // Try to find the definition
      const definitions = node.getDefinitionNodes();
      for (const def of definitions) {
        const defLine = def.getStartLineNumber();
        if (defLine < startLine) {
          // Variable is defined before the extracted code
          seen.add(name);

          // Try to get the type
          let type = 'any';
          if (Node.isVariableDeclaration(def)) {
            const typeNode = def.getTypeNode();
            type = typeNode?.getText() || def.getType().getText() || 'any';
          }

          variables.push({ name, type });
        }
      }
    }
  });

  return variables;
}

function findReturnedVariables(
  sourceFile: import('ts-morph').SourceFile,
  startLine: number,
  endLine: number
): VariableInfo[] {
  // Find variables declared in the range that are used after
  const variables: VariableInfo[] = [];
  const declared = new Map<string, string>();

  // First pass: find all declarations in the range
  sourceFile.forEachDescendant((node) => {
    const line = node.getStartLineNumber();
    if (line >= startLine && line <= endLine && Node.isVariableDeclaration(node)) {
      const name = node.getName();
      const typeNode = node.getTypeNode();
      const type = typeNode?.getText() || node.getType().getText() || 'any';
      declared.set(name, type);
    }
  });

  // Second pass: find usages after the range
  sourceFile.forEachDescendant((node) => {
    const line = node.getStartLineNumber();
    if (line > endLine && Node.isIdentifier(node)) {
      const name = node.getText();
      if (declared.has(name) && !variables.some((v) => v.name === name)) {
        variables.push({ name, type: declared.get(name)! });
      }
    }
  });

  return variables;
}

function findContainingFunctionOrClass(
  sourceFile: import('ts-morph').SourceFile,
  line: number
): Node | undefined {
  let result: Node | undefined;

  sourceFile.forEachDescendant((node) => {
    const startLine = node.getStartLineNumber();
    const endLine = node.getEndLineNumber();

    if (startLine <= line && endLine >= line) {
      if (
        Node.isFunctionDeclaration(node) ||
        Node.isMethodDeclaration(node) ||
        Node.isClassDeclaration(node) ||
        Node.isArrowFunction(node)
      ) {
        result = node;
      }
    }
  });

  return result;
}

// Tool definition for MCP
export const typescriptExtractFunctionTool = {
  name: 'typescript_extract_function',
  description: 'Extract a code block into a new function, automatically determining parameters and return values',
  inputSchema: {
    type: 'object',
    properties: {
      tsconfigPath: {
        type: 'string',
        description: 'Path to tsconfig.json',
      },
      filePath: {
        type: 'string',
        description: 'Path to the file containing the code',
      },
      startLine: {
        type: 'number',
        description: 'Start line of the code to extract (1-indexed)',
      },
      endLine: {
        type: 'number',
        description: 'End line of the code to extract (1-indexed)',
      },
      functionName: {
        type: 'string',
        description: 'Name for the extracted function',
      },
      dryRun: {
        type: 'boolean',
        description: 'Preview changes without applying (default: true)',
      },
    },
    required: ['tsconfigPath', 'filePath', 'startLine', 'endLine', 'functionName'],
  },
};
