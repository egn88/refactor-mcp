// Re-export all TypeScript tools and schemas

export {
  typescriptRenameSymbol,
  typescriptRenameSymbolSchema,
  typescriptRenameSymbolTool,
} from './rename.js';

export {
  typescriptMoveSymbol,
  typescriptMoveSymbolSchema,
  typescriptMoveSymbolTool,
} from './move.js';

export {
  typescriptRenameFile,
  typescriptRenameFileSchema,
  typescriptRenameFileTool,
} from './rename-file.js';

export {
  typescriptExtractFunction,
  typescriptExtractFunctionSchema,
  typescriptExtractFunctionTool,
} from './extract.js';

export {
  typescriptAddParameter,
  typescriptAddParameterSchema,
  typescriptAddParameterTool,
  typescriptRemoveParameter,
  typescriptRemoveParameterSchema,
  typescriptRemoveParameterTool,
} from './signature.js';

// Import tools for the combined array
import { typescriptRenameSymbolTool } from './rename.js';
import { typescriptMoveSymbolTool } from './move.js';
import { typescriptRenameFileTool } from './rename-file.js';
import { typescriptExtractFunctionTool } from './extract.js';
import { typescriptAddParameterTool, typescriptRemoveParameterTool } from './signature.js';

// Combined array of all TypeScript tools
export const typescriptTools = [
  typescriptRenameSymbolTool,
  typescriptMoveSymbolTool,
  typescriptRenameFileTool,
  typescriptExtractFunctionTool,
  typescriptAddParameterTool,
  typescriptRemoveParameterTool,
];
