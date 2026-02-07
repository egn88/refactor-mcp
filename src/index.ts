#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { loadConfig } from './config.js';

// Import utility tools
import {
  utilityTools,
  detectProjectType,
  detectProjectTypeSchema,
} from './tools/utility/detect-project.js';

// Import TypeScript tools
import {
  typescriptTools,
  typescriptRenameSymbol,
  typescriptRenameSymbolSchema,
  typescriptMoveSymbol,
  typescriptMoveSymbolSchema,
  typescriptRenameFile,
  typescriptRenameFileSchema,
  typescriptExtractFunction,
  typescriptExtractFunctionSchema,
  typescriptAddParameter,
  typescriptAddParameterSchema,
  typescriptRemoveParameter,
  typescriptRemoveParameterSchema,
} from './tools/typescript/index.js';

// Import Java tools
import {
  javaTools,
  javaRenameClass,
  javaRenameClassSchema,
  javaRenameMethod,
  javaRenameMethodSchema,
  javaRenameField,
  javaRenameFieldSchema,
  javaMoveClass,
  javaMoveClassSchema,
  javaAddParameter,
  javaAddParameterSchema,
  javaRemoveParameter,
  javaRemoveParameterSchema,
  javaReorderParameters,
  javaReorderParametersSchema,
} from './tools/java/index.js';

// Combine all tools
const allTools = [...utilityTools, ...typescriptTools, ...javaTools];

// Initialize server
const server = new Server(
  {
    name: 'java-refactor-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Load config
const config = loadConfig();

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: allTools };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: string;

    switch (name) {
      // Utility tools
      case 'detect_project_type': {
        const params = detectProjectTypeSchema.parse(args);
        result = await detectProjectType(params);
        break;
      }

      // TypeScript tools
      case 'typescript_rename_symbol': {
        const params = typescriptRenameSymbolSchema.parse(args);
        result = await typescriptRenameSymbol(params);
        break;
      }
      case 'typescript_move_symbol': {
        const params = typescriptMoveSymbolSchema.parse(args);
        result = await typescriptMoveSymbol(params);
        break;
      }
      case 'typescript_rename_file': {
        const params = typescriptRenameFileSchema.parse(args);
        result = await typescriptRenameFile(params);
        break;
      }
      case 'typescript_extract_function': {
        const params = typescriptExtractFunctionSchema.parse(args);
        result = await typescriptExtractFunction(params);
        break;
      }
      case 'typescript_add_parameter': {
        const params = typescriptAddParameterSchema.parse(args);
        result = await typescriptAddParameter(params);
        break;
      }
      case 'typescript_remove_parameter': {
        const params = typescriptRemoveParameterSchema.parse(args);
        result = await typescriptRemoveParameter(params);
        break;
      }

      // Java tools
      case 'java_rename_class': {
        const params = javaRenameClassSchema.parse(args);
        result = await javaRenameClass(config, params);
        break;
      }
      case 'java_rename_method': {
        const params = javaRenameMethodSchema.parse(args);
        result = await javaRenameMethod(config, params);
        break;
      }
      case 'java_rename_field': {
        const params = javaRenameFieldSchema.parse(args);
        result = await javaRenameField(config, params);
        break;
      }
      case 'java_move_class': {
        const params = javaMoveClassSchema.parse(args);
        result = await javaMoveClass(config, params);
        break;
      }
      case 'java_add_parameter': {
        const params = javaAddParameterSchema.parse(args);
        result = await javaAddParameter(config, params);
        break;
      }
      case 'java_remove_parameter': {
        const params = javaRemoveParameterSchema.parse(args);
        result = await javaRemoveParameter(config, params);
        break;
      }
      case 'java_reorder_parameters': {
        const params = javaReorderParametersSchema.parse(args);
        result = await javaReorderParameters(config, params);
        break;
      }

      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }

    return {
      content: [{ type: 'text', text: result }],
    };
  } catch (error) {
    let errorMessage: string;

    if (error instanceof Error) {
      errorMessage = error.message;
    } else {
      errorMessage = 'An unknown error occurred';
    }

    return {
      content: [{ type: 'text', text: errorMessage }],
      isError: true,
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Java/TypeScript Refactoring MCP server started');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
