// Re-export all Java tools and schemas

export {
  javaRenameClass,
  javaRenameClassSchema,
  javaRenameClassTool,
  javaRenameMethod,
  javaRenameMethodSchema,
  javaRenameMethodTool,
  javaRenameField,
  javaRenameFieldSchema,
  javaRenameFieldTool,
} from './rename.js';

export {
  javaMoveClass,
  javaMoveClassSchema,
  javaMoveClassTool,
} from './move.js';

export {
  javaAddParameter,
  javaAddParameterSchema,
  javaAddParameterTool,
  javaRemoveParameter,
  javaRemoveParameterSchema,
  javaRemoveParameterTool,
  javaReorderParameters,
  javaReorderParametersSchema,
  javaReorderParametersTool,
} from './signature.js';

// Import tools for the combined array
import { javaRenameClassTool, javaRenameMethodTool, javaRenameFieldTool } from './rename.js';
import { javaMoveClassTool } from './move.js';
import { javaAddParameterTool, javaRemoveParameterTool, javaReorderParametersTool } from './signature.js';

// Combined array of all Java tools
export const javaTools = [
  javaRenameClassTool,
  javaRenameMethodTool,
  javaRenameFieldTool,
  javaMoveClassTool,
  javaAddParameterTool,
  javaRemoveParameterTool,
  javaReorderParametersTool,
];
