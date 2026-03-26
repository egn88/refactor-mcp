import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, sep } from 'path';

/**
 * Information about a Java record
 */
export interface RecordInfo {
  isRecord: boolean;
  filePath?: string;
  components?: RecordComponent[];
  packageName?: string;
  className?: string;
  annotations?: string[];
}

/**
 * A component (field) in a Java record
 */
export interface RecordComponent {
  type: string;
  name: string;
  annotations?: string[];
}

/**
 * Result of modifying a record
 */
export interface RecordModificationResult {
  success: boolean;
  modifiedContent?: string;
  error?: string;
  originalContent?: string;
}

/**
 * Recursively search for a file in a directory
 */
function findFileRecursive(dir: string, fileName: string, maxDepth: number = 10): string | null {
  if (maxDepth <= 0) return null;

  try {
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isFile() && entry.name === fileName) {
        return fullPath;
      }

      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'target' && entry.name !== 'build') {
        const result = findFileRecursive(fullPath, fileName, maxDepth - 1);
        if (result) return result;
      }
    }
  } catch {
    // Directory not accessible
  }

  return null;
}

/**
 * Find the source file for a fully qualified class name in a Java project
 */
export async function findJavaSourceFile(
  projectPath: string,
  fullyQualifiedClassName: string
): Promise<string | null> {
  // Convert FQN to relative path: com.example.MyClass -> com/example/MyClass.java
  const relativePath = fullyQualifiedClassName.replace(/\./g, sep) + '.java';
  const fileName = fullyQualifiedClassName.split('.').pop() + '.java';

  // Common source directories to check
  const sourceRoots = [
    'src/main/java',
    'src/test/java',
    'src',
    'app/src/main/java',
    'app/src/test/java',
  ];

  for (const root of sourceRoots) {
    const fullPath = join(projectPath, root, relativePath);
    if (existsSync(fullPath)) {
      return fullPath;
    }
  }

  // Fallback: search recursively for the file
  const result = findFileRecursive(projectPath, fileName);
  if (result) {
    // Verify the package matches by reading the file
    try {
      const content = readFileSync(result, 'utf-8');
      const packageMatch = content.match(/^\s*package\s+([\w.]+)\s*;/m);
      const expectedPackage = fullyQualifiedClassName.substring(0, fullyQualifiedClassName.lastIndexOf('.'));
      if (packageMatch && packageMatch[1] === expectedPackage) {
        return result;
      }
    } catch {
      // Can't read file
    }
  }

  return null;
}

/**
 * Detect if a Java class is a record by parsing the source file
 */
export async function detectJavaRecord(
  projectPath: string,
  fullyQualifiedClassName: string
): Promise<RecordInfo> {
  const filePath = await findJavaSourceFile(projectPath, fullyQualifiedClassName);

  if (!filePath) {
    return { isRecord: false };
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    return parseRecordFromSource(content, filePath);
  } catch {
    return { isRecord: false };
  }
}

/**
 * Extract balanced parentheses content from a string starting at a given position
 */
function extractBalancedParentheses(str: string, startPos: number): string | null {
  if (str[startPos] !== '(') return null;

  let depth = 0;
  let result = '';

  for (let i = startPos; i < str.length; i++) {
    const char = str[i];
    if (char === '(') {
      depth++;
      if (depth > 1) result += char;
    } else if (char === ')') {
      depth--;
      if (depth === 0) {
        return result;
      }
      result += char;
    } else {
      if (depth > 0) result += char;
    }
  }

  return null; // Unbalanced
}

/**
 * Parse record information from Java source content
 */
export function parseRecordFromSource(content: string, filePath?: string): RecordInfo {
  // Extract package name
  const packageMatch = content.match(/^\s*package\s+([\w.]+)\s*;/m);
  const packageName = packageMatch ? packageMatch[1] : undefined;

  // Find record declaration: modifiers? record ClassName(
  const recordStartPattern = /(?:public\s+|private\s+|protected\s+)?(?:final\s+)?record\s+(\w+)\s*\(/g;
  const startMatch = recordStartPattern.exec(content);

  if (!startMatch) {
    return { isRecord: false };
  }

  const className = startMatch[1];
  const openParenPos = startMatch.index + startMatch[0].length - 1;

  // Extract components using balanced parentheses
  const componentsStr = extractBalancedParentheses(content, openParenPos);

  if (componentsStr === null) {
    return { isRecord: false };
  }

  // Parse components
  const components = parseRecordComponents(componentsStr);

  // Extract class-level annotations
  const annotationPattern = /@(\w+)(?:\([^)]*\))?\s*(?=(?:public\s+|private\s+|protected\s+)?(?:final\s+)?record\s)/g;
  const annotations: string[] = [];
  let annotationMatch;
  while ((annotationMatch = annotationPattern.exec(content)) !== null) {
    annotations.push('@' + annotationMatch[1]);
  }

  return {
    isRecord: true,
    filePath,
    packageName,
    className,
    components,
    annotations,
  };
}

/**
 * Parse record components from the component string
 * E.g., "String name, int age, @NotNull List<String> items"
 */
export function parseRecordComponents(componentsStr: string): RecordComponent[] {
  if (!componentsStr.trim()) {
    return [];
  }

  const components: RecordComponent[] = [];

  // Split by comma, but respect generics like List<String, Integer>
  const parts = splitComponentsRespectingGenerics(componentsStr);

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    // Parse annotations, type, and name from component
    // Pattern: (@Annotation)* Type name
    const componentPattern = /^((?:@\w+(?:\([^)]*\))?\s*)*)(.+?)\s+(\w+)$/;
    const match = trimmed.match(componentPattern);

    if (match) {
      const annotationsStr = match[1].trim();
      const type = match[2].trim();
      const name = match[3];

      const annotations: string[] = [];
      if (annotationsStr) {
        const annMatches = annotationsStr.matchAll(/@(\w+(?:\([^)]*\))?)/g);
        for (const annMatch of annMatches) {
          annotations.push('@' + annMatch[1]);
        }
      }

      components.push({ type, name, annotations: annotations.length > 0 ? annotations : undefined });
    }
  }

  return components;
}

/**
 * Split component string by comma while respecting generics and annotation parentheses
 */
function splitComponentsRespectingGenerics(str: string): string[] {
  const parts: string[] = [];
  let current = '';
  let angleDepth = 0;  // For generics < >
  let parenDepth = 0;  // For annotation arguments ( )

  for (const char of str) {
    if (char === '<') {
      angleDepth++;
      current += char;
    } else if (char === '>') {
      angleDepth--;
      current += char;
    } else if (char === '(') {
      parenDepth++;
      current += char;
    } else if (char === ')') {
      parenDepth--;
      current += char;
    } else if (char === ',' && angleDepth === 0 && parenDepth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    parts.push(current);
  }

  return parts;
}

/**
 * Formatting info for preserving record style
 */
interface RecordFormattingInfo {
  isMultiline: boolean;
  indentation: string;
  componentSeparator: string;
}

/**
 * Detect the formatting style of a record's components
 */
function detectRecordFormatting(sourceContent: string, componentsStr: string, openParenPos: number): RecordFormattingInfo {
  // Check if the original record is multiline by looking at the content between ( and )
  const isMultiline = componentsStr.includes('\n');

  if (!isMultiline) {
    return {
      isMultiline: false,
      indentation: '',
      componentSeparator: ', ',
    };
  }

  // Detect indentation by finding the whitespace before the first component
  // Look at what comes after the opening paren
  const afterOpenParen = sourceContent.substring(openParenPos + 1);
  const firstLineMatch = afterOpenParen.match(/^\s*\n(\s*)/);

  let indentation = '    '; // Default to 4 spaces
  if (firstLineMatch) {
    indentation = firstLineMatch[1];
  } else {
    // Try to detect indentation from the record declaration line
    const beforeMatch = sourceContent.substring(0, openParenPos).match(/^(\s*).*$/m);
    if (beforeMatch) {
      // Add extra indent (4 spaces or 1 tab)
      indentation = beforeMatch[1] + '    ';
    }
  }

  return {
    isMultiline: true,
    indentation,
    componentSeparator: ',\n' + indentation,
  };
}

/**
 * Find the record declaration info in source content
 * Returns the match info including positions for replacement
 */
function findRecordDeclaration(sourceContent: string): {
  found: boolean;
  beforeComponents?: string;
  componentsStr?: string;
  fullMatchStart?: number;
  fullMatchEnd?: number;
  formatting?: RecordFormattingInfo;
} {
  // Find record declaration: modifiers? record ClassName(
  const recordStartPattern = /(?:@\w+(?:\([^)]*\))?\s*)*(?:public\s+|private\s+|protected\s+)?(?:final\s+)?record\s+\w+\s*\(/g;
  const startMatch = recordStartPattern.exec(sourceContent);

  if (!startMatch) {
    return { found: false };
  }

  const openParenPos = startMatch.index + startMatch[0].length - 1;
  const beforeComponents = sourceContent.substring(startMatch.index, openParenPos);

  // Extract components using balanced parentheses
  const componentsStr = extractBalancedParentheses(sourceContent, openParenPos);

  if (componentsStr === null) {
    return { found: false };
  }

  // Find the closing paren position
  let depth = 0;
  let closeParenPos = openParenPos;
  for (let i = openParenPos; i < sourceContent.length; i++) {
    if (sourceContent[i] === '(') depth++;
    else if (sourceContent[i] === ')') {
      depth--;
      if (depth === 0) {
        closeParenPos = i;
        break;
      }
    }
  }

  // Detect formatting style
  const formatting = detectRecordFormatting(sourceContent, componentsStr, openParenPos);

  return {
    found: true,
    beforeComponents,
    componentsStr,
    fullMatchStart: startMatch.index,
    fullMatchEnd: closeParenPos + 1,
    formatting,
  };
}

/**
 * Build formatted component list string based on formatting style
 */
function buildFormattedComponentList(
  componentStrings: string[],
  formatting: RecordFormattingInfo
): string {
  if (componentStrings.length === 0) {
    return '';
  }

  if (!formatting.isMultiline) {
    return componentStrings.join(', ');
  }

  // Multiline format: each component on its own line with proper indentation
  return '\n' + formatting.indentation + componentStrings.join(formatting.componentSeparator) + '\n';
}

/**
 * Add a component to a Java record
 */
export function addRecordComponent(
  sourceContent: string,
  componentType: string,
  componentName: string,
  index?: number,
  annotations?: string[]
): RecordModificationResult {
  const recordInfo = findRecordDeclaration(sourceContent);

  if (!recordInfo.found) {
    return {
      success: false,
      error: 'Could not find record declaration in source file',
      originalContent: sourceContent,
    };
  }

  const { beforeComponents, componentsStr, fullMatchStart, fullMatchEnd, formatting } = recordInfo;

  // Parse existing components
  const components = parseRecordComponents(componentsStr!);

  // Build the new component string
  const annotationStr = annotations && annotations.length > 0
    ? annotations.join(' ') + ' '
    : '';
  const newComponent = `${annotationStr}${componentType} ${componentName}`;

  // Insert at the specified index or at the end
  const insertIndex = index !== undefined ? Math.min(index, components.length) : components.length;

  // Rebuild component strings
  const componentStrings: string[] = [];
  for (let i = 0; i < components.length; i++) {
    const comp = components[i];
    const annStr = comp.annotations ? comp.annotations.join(' ') + ' ' : '';
    componentStrings.push(`${annStr}${comp.type} ${comp.name}`);
  }

  // Insert new component
  componentStrings.splice(insertIndex, 0, newComponent);

  // Build new record declaration with preserved formatting
  const newComponents = buildFormattedComponentList(componentStrings, formatting!);
  const newDeclaration = `${beforeComponents}(${newComponents})`;

  // Replace in source using positions
  const modifiedContent =
    sourceContent.substring(0, fullMatchStart!) +
    newDeclaration +
    sourceContent.substring(fullMatchEnd!);

  return {
    success: true,
    modifiedContent,
    originalContent: sourceContent,
  };
}

/**
 * Remove a component from a Java record
 */
export function removeRecordComponent(
  sourceContent: string,
  componentIndex: number
): RecordModificationResult {
  const recordInfo = findRecordDeclaration(sourceContent);

  if (!recordInfo.found) {
    return {
      success: false,
      error: 'Could not find record declaration in source file',
      originalContent: sourceContent,
    };
  }

  const { beforeComponents, componentsStr, fullMatchStart, fullMatchEnd, formatting } = recordInfo;

  // Parse existing components
  const components = parseRecordComponents(componentsStr!);

  if (componentIndex < 0 || componentIndex >= components.length) {
    return {
      success: false,
      error: `Component index ${componentIndex} is out of range (0-${components.length - 1})`,
      originalContent: sourceContent,
    };
  }

  // Rebuild component strings without the removed component
  const componentStrings: string[] = [];
  for (let i = 0; i < components.length; i++) {
    if (i === componentIndex) continue;
    const comp = components[i];
    const annStr = comp.annotations ? comp.annotations.join(' ') + ' ' : '';
    componentStrings.push(`${annStr}${comp.type} ${comp.name}`);
  }

  // Build new record declaration with preserved formatting
  const newComponents = buildFormattedComponentList(componentStrings, formatting!);
  const newDeclaration = `${beforeComponents}(${newComponents})`;

  // Replace in source using positions
  const modifiedContent =
    sourceContent.substring(0, fullMatchStart!) +
    newDeclaration +
    sourceContent.substring(fullMatchEnd!);

  return {
    success: true,
    modifiedContent,
    originalContent: sourceContent,
  };
}

/**
 * Reorder components in a Java record
 */
export function reorderRecordComponents(
  sourceContent: string,
  newOrder: string[]
): RecordModificationResult {
  const recordInfo = findRecordDeclaration(sourceContent);

  if (!recordInfo.found) {
    return {
      success: false,
      error: 'Could not find record declaration in source file',
      originalContent: sourceContent,
    };
  }

  const { beforeComponents, componentsStr, fullMatchStart, fullMatchEnd, formatting } = recordInfo;

  // Parse existing components
  const components = parseRecordComponents(componentsStr!);

  // Build a map of component name to component
  const componentMap = new Map<string, RecordComponent>();
  for (const comp of components) {
    componentMap.set(comp.name, comp);
  }

  // Validate new order
  for (const name of newOrder) {
    if (!componentMap.has(name)) {
      return {
        success: false,
        error: `Component '${name}' not found in record`,
        originalContent: sourceContent,
      };
    }
  }

  // Rebuild in new order
  const componentStrings: string[] = [];
  for (const name of newOrder) {
    const comp = componentMap.get(name)!;
    const annStr = comp.annotations ? comp.annotations.join(' ') + ' ' : '';
    componentStrings.push(`${annStr}${comp.type} ${comp.name}`);
  }

  // Build new record declaration with preserved formatting
  const newComponents = buildFormattedComponentList(componentStrings, formatting!);
  const newDeclaration = `${beforeComponents}(${newComponents})`;

  // Replace in source using positions
  const modifiedContent =
    sourceContent.substring(0, fullMatchStart!) +
    newDeclaration +
    sourceContent.substring(fullMatchEnd!);

  return {
    success: true,
    modifiedContent,
    originalContent: sourceContent,
  };
}
