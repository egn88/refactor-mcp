import { z } from 'zod';
import { TsMorphClientWithTracking } from '../../engines/ts-morph/client.js';
import { generateMultiFileDiff, formatRefactoringResult } from '../../utils/diff-utils.js';
import { resolve, dirname, relative, basename } from 'path';

export const typescriptRenameFileSchema = z.object({
  tsconfigPath: z.string().describe('Path to tsconfig.json'),
  oldFilePath: z.string().describe('Current file path'),
  newFilePath: z.string().describe('New file path'),
  dryRun: z.boolean().default(true).describe('Preview changes without applying (default: true)'),
});

export type TypescriptRenameFileParams = z.infer<typeof typescriptRenameFileSchema>;

export async function typescriptRenameFile(params: TypescriptRenameFileParams): Promise<string> {
  try {
    const client = new TsMorphClientWithTracking(params.tsconfigPath);
    const project = client.getProject();

    const oldPath = resolve(params.oldFilePath);
    const newPath = resolve(params.newFilePath);

    // Get the source file to rename
    const sourceFile = client.getSourceFile(oldPath);
    if (!sourceFile) {
      return formatRefactoringResult({
        success: false,
        message: `Source file not found: ${params.oldFilePath}`,
        filesChanged: 0,
      });
    }

    // Move the file (this updates all imports automatically)
    sourceFile.move(newPath);

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
        ? `Dry run: would rename '${params.oldFilePath}' to '${params.newFilePath}'`
        : `Renamed '${params.oldFilePath}' to '${params.newFilePath}'`,
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
export const typescriptRenameFileTool = {
  name: 'typescript_rename_file',
  description: 'Rename or move a TypeScript/JavaScript file and update all imports',
  inputSchema: {
    type: 'object',
    properties: {
      tsconfigPath: {
        type: 'string',
        description: 'Path to tsconfig.json',
      },
      oldFilePath: {
        type: 'string',
        description: 'Current file path',
      },
      newFilePath: {
        type: 'string',
        description: 'New file path',
      },
      dryRun: {
        type: 'boolean',
        description: 'Preview changes without applying (default: true)',
      },
    },
    required: ['tsconfigPath', 'oldFilePath', 'newFilePath'],
  },
};
