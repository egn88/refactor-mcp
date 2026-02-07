import { z } from 'zod';
import { Node } from 'ts-morph';
import { TsMorphClientWithTracking } from '../../engines/ts-morph/client.js';
import { generateMultiFileDiff, formatRefactoringResult } from '../../utils/diff-utils.js';
import { validateTypeScriptIdentifier } from '../../utils/validation.js';

export const typescriptRenameSymbolSchema = z.object({
  tsconfigPath: z.string().describe('Path to tsconfig.json'),
  symbolName: z.string().describe('Current name of the symbol to rename'),
  newName: z.string().describe('New name for the symbol'),
  filePath: z.string().optional().describe('Optional: specific file to search in'),
  dryRun: z.boolean().default(true).describe('Preview changes without applying (default: true)'),
});

export type TypescriptRenameSymbolParams = z.infer<typeof typescriptRenameSymbolSchema>;

export async function typescriptRenameSymbol(params: TypescriptRenameSymbolParams): Promise<string> {
  // Validate new name
  const validation = validateTypeScriptIdentifier(params.newName);
  if (!validation.valid) {
    return formatRefactoringResult({
      success: false,
      message: validation.error || 'Invalid identifier',
      filesChanged: 0,
    });
  }

  try {
    const client = new TsMorphClientWithTracking(params.tsconfigPath);

    // Find the symbol
    const symbol = client.findSymbol(params.symbolName, params.filePath);

    if (!symbol) {
      return formatRefactoringResult({
        success: false,
        message: `Symbol not found: ${params.symbolName}`,
        filesChanged: 0,
      });
    }

    // Rename the symbol - ts-morph handles finding all references
    if (Node.isRenameable(symbol)) {
      symbol.rename(params.newName);
    } else {
      return formatRefactoringResult({
        success: false,
        message: `Symbol cannot be renamed: ${params.symbolName}`,
        filesChanged: 0,
      });
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
        ? `Dry run: would rename '${params.symbolName}' to '${params.newName}'`
        : `Renamed '${params.symbolName}' to '${params.newName}'`,
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

// Tool definition for MCP
export const typescriptRenameSymbolTool = {
  name: 'typescript_rename_symbol',
  description: 'Rename any TypeScript/JavaScript symbol (class, function, variable, interface, type) and update all references',
  inputSchema: {
    type: 'object',
    properties: {
      tsconfigPath: {
        type: 'string',
        description: 'Path to tsconfig.json',
      },
      symbolName: {
        type: 'string',
        description: 'Current name of the symbol to rename',
      },
      newName: {
        type: 'string',
        description: 'New name for the symbol',
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
    required: ['tsconfigPath', 'symbolName', 'newName'],
  },
};
