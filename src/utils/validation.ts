import { existsSync, statSync } from 'fs';
import { resolve } from 'path';

export function validatePath(path: string, type: 'file' | 'directory'): { valid: boolean; error?: string } {
  const resolvedPath = resolve(path);

  if (!existsSync(resolvedPath)) {
    return { valid: false, error: `Path does not exist: ${resolvedPath}` };
  }

  const stat = statSync(resolvedPath);

  if (type === 'file' && !stat.isFile()) {
    return { valid: false, error: `Path is not a file: ${resolvedPath}` };
  }

  if (type === 'directory' && !stat.isDirectory()) {
    return { valid: false, error: `Path is not a directory: ${resolvedPath}` };
  }

  return { valid: true };
}

export function validateJavaIdentifier(name: string): { valid: boolean; error?: string } {
  // Java identifier rules: starts with letter, $, or _, followed by letters, digits, $, or _
  const javaIdentifierRegex = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

  if (!javaIdentifierRegex.test(name)) {
    return { valid: false, error: `Invalid Java identifier: ${name}` };
  }

  // Check for reserved keywords
  const reservedWords = [
    'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char',
    'class', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum',
    'extends', 'final', 'finally', 'float', 'for', 'goto', 'if', 'implements',
    'import', 'instanceof', 'int', 'interface', 'long', 'native', 'new', 'package',
    'private', 'protected', 'public', 'return', 'short', 'static', 'strictfp',
    'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient',
    'try', 'void', 'volatile', 'while', 'true', 'false', 'null'
  ];

  if (reservedWords.includes(name)) {
    return { valid: false, error: `Cannot use reserved keyword as identifier: ${name}` };
  }

  return { valid: true };
}

export function validateTypeScriptIdentifier(name: string): { valid: boolean; error?: string } {
  // TypeScript identifier rules are similar to JavaScript
  const tsIdentifierRegex = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

  if (!tsIdentifierRegex.test(name)) {
    return { valid: false, error: `Invalid TypeScript identifier: ${name}` };
  }

  // Check for reserved keywords
  const reservedWords = [
    'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default',
    'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for',
    'function', 'if', 'import', 'in', 'instanceof', 'new', 'null', 'return', 'super',
    'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with',
    'as', 'implements', 'interface', 'let', 'package', 'private', 'protected', 'public',
    'static', 'yield'
  ];

  if (reservedWords.includes(name)) {
    return { valid: false, error: `Cannot use reserved keyword as identifier: ${name}` };
  }

  return { valid: true };
}

export function validatePackageName(name: string): { valid: boolean; error?: string } {
  // Package name is dot-separated Java identifiers
  const parts = name.split('.');

  for (const part of parts) {
    const result = validateJavaIdentifier(part);
    if (!result.valid) {
      return { valid: false, error: `Invalid package name: ${result.error}` };
    }
  }

  return { valid: true };
}

export function validateFullyQualifiedClassName(name: string): { valid: boolean; error?: string } {
  const lastDot = name.lastIndexOf('.');

  if (lastDot === -1) {
    // No package, just a class name
    return validateJavaIdentifier(name);
  }

  const packageName = name.substring(0, lastDot);
  const className = name.substring(lastDot + 1);

  const packageResult = validatePackageName(packageName);
  if (!packageResult.valid) {
    return packageResult;
  }

  return validateJavaIdentifier(className);
}
