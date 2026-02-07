import { createTwoFilesPatch } from 'diff';

export interface FileChange {
  filePath: string;
  originalContent: string;
  modifiedContent: string;
}

export function generateDiff(change: FileChange): string {
  return createTwoFilesPatch(
    change.filePath,
    change.filePath,
    change.originalContent,
    change.modifiedContent,
    'original',
    'modified'
  );
}

export function generateMultiFileDiff(changes: FileChange[]): string {
  return changes.map(generateDiff).join('\n');
}

export interface RefactoringResult {
  success: boolean;
  message: string;
  filesChanged: number;
  diff?: string;
  errors?: string[];
}

export function formatRefactoringResult(result: RefactoringResult): string {
  return JSON.stringify(result, null, 2);
}
