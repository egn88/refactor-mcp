import { z } from 'zod';
import { Node, SourceFile, StructureKind, FunctionDeclarationStructure } from 'ts-morph';
import { TsMorphClientWithTracking } from '../../engines/ts-morph/client.js';
import { generateMultiFileDiff, formatRefactoringResult } from '../../utils/diff-utils.js';
import { resolve, dirname, relative } from 'path';

export const typescriptMoveSymbolSchema = z.object({
  tsconfigPath: z.string().describe('Path to tsconfig.json'),
  symbolName: z.string().describe('Name of the symbol to move'),
  sourceFilePath: z.string().describe('Current file containing the symbol'),
  targetFilePath: z.string().describe('Target file to move the symbol to'),
  dryRun: z.boolean().default(true).describe('Preview changes without applying (default: true)'),
});

export type TypescriptMoveSymbolParams = z.infer<typeof typescriptMoveSymbolSchema>;

export async function typescriptMoveSymbol(params: TypescriptMoveSymbolParams): Promise<string> {
  try {
    const client = new TsMorphClientWithTracking(params.tsconfigPath);
    const project = client.getProject();

    // Get source file
    const sourceFile = client.getSourceFile(params.sourceFilePath);
    if (!sourceFile) {
      return formatRefactoringResult({
        success: false,
        message: `Source file not found: ${params.sourceFilePath}`,
        filesChanged: 0,
      });
    }

    // Find the symbol in the source file
    const symbol = client.findSymbol(params.symbolName, params.sourceFilePath);
    if (!symbol) {
      return formatRefactoringResult({
        success: false,
        message: `Symbol not found in source file: ${params.symbolName}`,
        filesChanged: 0,
      });
    }

    // Get or create target file
    let targetFile = client.getSourceFile(params.targetFilePath);
    if (!targetFile) {
      targetFile = project.createSourceFile(resolve(params.targetFilePath), '');
    }

    // Get the full text of the symbol to move
    const symbolText = symbol.getFullText();

    // Check if the symbol is exported
    let isExported = false;
    if (Node.isExportable(symbol)) {
      isExported = symbol.isExported();
    }

    // Get imports needed by the symbol
    const imports = collectImportsForSymbol(symbol, sourceFile);

    // Add necessary imports to target file
    for (const importInfo of imports) {
      const existingImport = targetFile.getImportDeclaration(
        (imp) => imp.getModuleSpecifierValue() === importInfo.moduleSpecifier
      );

      if (!existingImport) {
        targetFile.addImportDeclaration({
          moduleSpecifier: importInfo.moduleSpecifier,
          namedImports: importInfo.namedImports,
          defaultImport: importInfo.defaultImport,
        });
      }
    }

    // Add the symbol to target file
    if (Node.isClassDeclaration(symbol)) {
      const classStructure = symbol.getStructure();
      if (isExported) {
        classStructure.isExported = true;
      }
      targetFile.addClass(classStructure);
    } else if (Node.isFunctionDeclaration(symbol)) {
      const funcStructure = symbol.getStructure();
      // Handle potential overload structure
      if (funcStructure.kind === StructureKind.Function) {
        if (isExported) {
          funcStructure.isExported = true;
        }
        targetFile.addFunction(funcStructure as FunctionDeclarationStructure);
      } else {
        // For overloads, just copy the text
        targetFile.addStatements(symbol.getFullText());
      }
    } else if (Node.isInterfaceDeclaration(symbol)) {
      const interfaceStructure = symbol.getStructure();
      if (isExported) {
        interfaceStructure.isExported = true;
      }
      targetFile.addInterface(interfaceStructure);
    } else if (Node.isTypeAliasDeclaration(symbol)) {
      const typeStructure = symbol.getStructure();
      if (isExported) {
        typeStructure.isExported = true;
      }
      targetFile.addTypeAlias(typeStructure);
    } else if (Node.isEnumDeclaration(symbol)) {
      const enumStructure = symbol.getStructure();
      if (isExported) {
        enumStructure.isExported = true;
      }
      targetFile.addEnum(enumStructure);
    } else if (Node.isVariableDeclaration(symbol)) {
      const varStmt = symbol.getVariableStatement();
      if (varStmt) {
        const structure = varStmt.getStructure();
        if (isExported) {
          structure.isExported = true;
        }
        targetFile.addVariableStatement(structure);
      }
    } else {
      return formatRefactoringResult({
        success: false,
        message: `Cannot move symbol of this type: ${symbol.getKindName()}`,
        filesChanged: 0,
      });
    }

    // Remove the symbol from source file
    if (Node.isClassDeclaration(symbol) ||
        Node.isFunctionDeclaration(symbol) ||
        Node.isInterfaceDeclaration(symbol) ||
        Node.isTypeAliasDeclaration(symbol) ||
        Node.isEnumDeclaration(symbol)) {
      symbol.remove();
    } else if (Node.isVariableDeclaration(symbol)) {
      const varStmt = symbol.getVariableStatement();
      if (varStmt) {
        varStmt.remove();
      }
    }

    // Update imports in all files that reference this symbol
    const targetModuleSpecifier = calculateModuleSpecifier(sourceFile, targetFile);

    for (const sf of project.getSourceFiles()) {
      if (sf === targetFile) continue;

      updateImportsForMovedSymbol(
        sf,
        params.symbolName,
        params.sourceFilePath,
        params.targetFilePath
      );
    }

    // Add import to source file if it still uses the symbol
    const sourceStillUsesSymbol = sourceFile.getFullText().includes(params.symbolName);
    if (sourceStillUsesSymbol) {
      sourceFile.addImportDeclaration({
        moduleSpecifier: targetModuleSpecifier,
        namedImports: [params.symbolName],
      });
    }

    // Organize imports in all modified files
    targetFile.organizeImports();
    sourceFile.organizeImports();

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
        ? `Dry run: would move '${params.symbolName}' to '${params.targetFilePath}'`
        : `Moved '${params.symbolName}' to '${params.targetFilePath}'`,
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

interface ImportInfo {
  moduleSpecifier: string;
  namedImports?: string[];
  defaultImport?: string;
}

function collectImportsForSymbol(symbol: Node, sourceFile: SourceFile): ImportInfo[] {
  // Get all type references and identifiers used by the symbol
  const imports: ImportInfo[] = [];
  const symbolText = symbol.getFullText();

  for (const importDecl of sourceFile.getImportDeclarations()) {
    const namedImports = importDecl.getNamedImports();
    const defaultImport = importDecl.getDefaultImport();
    const moduleSpecifier = importDecl.getModuleSpecifierValue();

    const usedNamedImports: string[] = [];

    for (const namedImport of namedImports) {
      const importName = namedImport.getName();
      // Simple check if the import name appears in the symbol
      if (symbolText.includes(importName)) {
        usedNamedImports.push(importName);
      }
    }

    let usedDefaultImport: string | undefined;
    if (defaultImport && symbolText.includes(defaultImport.getText())) {
      usedDefaultImport = defaultImport.getText();
    }

    if (usedNamedImports.length > 0 || usedDefaultImport) {
      imports.push({
        moduleSpecifier,
        namedImports: usedNamedImports.length > 0 ? usedNamedImports : undefined,
        defaultImport: usedDefaultImport,
      });
    }
  }

  return imports;
}

function calculateModuleSpecifier(fromFile: SourceFile, toFile: SourceFile): string {
  const fromDir = dirname(fromFile.getFilePath());
  const toPath = toFile.getFilePath().replace(/\.tsx?$/, '');

  let relativePath = relative(fromDir, toPath);

  if (!relativePath.startsWith('.')) {
    relativePath = './' + relativePath;
  }

  return relativePath;
}

function updateImportsForMovedSymbol(
  sourceFile: SourceFile,
  symbolName: string,
  oldFilePath: string,
  newFilePath: string
): void {
  const importDeclarations = sourceFile.getImportDeclarations();

  for (const importDecl of importDeclarations) {
    const moduleSpecifier = importDecl.getModuleSpecifierValue();

    // Check if this import is from the old file
    // This is a simplified check - in production you'd resolve the full path
    if (moduleSpecifier.includes(oldFilePath.replace(/\.tsx?$/, '').split('/').pop()!)) {
      const namedImports = importDecl.getNamedImports();
      const hasSymbol = namedImports.some((ni) => ni.getName() === symbolName);

      if (hasSymbol) {
        // Calculate new module specifier
        const fromDir = dirname(sourceFile.getFilePath());
        const toPath = resolve(newFilePath).replace(/\.tsx?$/, '');
        let newModuleSpecifier = relative(fromDir, toPath);

        if (!newModuleSpecifier.startsWith('.')) {
          newModuleSpecifier = './' + newModuleSpecifier;
        }

        // If there's only this import, update the module specifier
        if (namedImports.length === 1) {
          importDecl.setModuleSpecifier(newModuleSpecifier);
        } else {
          // Remove the symbol from this import and add a new import
          const namedImport = namedImports.find((ni) => ni.getName() === symbolName);
          if (namedImport) {
            namedImport.remove();
            sourceFile.addImportDeclaration({
              moduleSpecifier: newModuleSpecifier,
              namedImports: [symbolName],
            });
          }
        }
      }
    }
  }
}

// Tool definition for MCP
export const typescriptMoveSymbolTool = {
  name: 'typescript_move_symbol',
  description: 'Move a TypeScript/JavaScript symbol to a different file and update all imports',
  inputSchema: {
    type: 'object',
    properties: {
      tsconfigPath: {
        type: 'string',
        description: 'Path to tsconfig.json',
      },
      symbolName: {
        type: 'string',
        description: 'Name of the symbol to move',
      },
      sourceFilePath: {
        type: 'string',
        description: 'Current file containing the symbol',
      },
      targetFilePath: {
        type: 'string',
        description: 'Target file to move the symbol to',
      },
      dryRun: {
        type: 'boolean',
        description: 'Preview changes without applying (default: true)',
      },
    },
    required: ['tsconfigPath', 'symbolName', 'sourceFilePath', 'targetFilePath'],
  },
};
