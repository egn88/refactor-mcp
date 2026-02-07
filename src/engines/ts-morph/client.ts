import { Project, SourceFile, Node, SyntaxKind } from 'ts-morph';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { FileChange } from '../../utils/diff-utils.js';

export class TsMorphClient {
  private project: Project;
  private tsconfigPath: string;

  constructor(tsconfigPath: string) {
    this.tsconfigPath = resolve(tsconfigPath);

    if (!existsSync(this.tsconfigPath)) {
      throw new Error(`tsconfig.json not found at: ${this.tsconfigPath}`);
    }

    this.project = new Project({
      tsConfigFilePath: this.tsconfigPath,
    });
  }

  getProject(): Project {
    return this.project;
  }

  getSourceFile(filePath: string): SourceFile | undefined {
    const resolved = resolve(filePath);
    return this.project.getSourceFile(resolved);
  }

  getSourceFileOrThrow(filePath: string): SourceFile {
    const sourceFile = this.getSourceFile(filePath);
    if (!sourceFile) {
      throw new Error(`Source file not found: ${filePath}`);
    }
    return sourceFile;
  }

  getAllSourceFiles(): SourceFile[] {
    return this.project.getSourceFiles();
  }

  /**
   * Collects all file changes without saving
   */
  collectChanges(): FileChange[] {
    const changes: FileChange[] = [];

    for (const sourceFile of this.project.getSourceFiles()) {
      const filePath = sourceFile.getFilePath();
      const originalContent = sourceFile.getFullText();

      // Get the modified text (unsaved)
      const modifiedContent = sourceFile.getFullText();

      // Only include if there were actual changes
      // Note: In ts-morph, changes are applied immediately to the AST
      // We need to track originals separately for proper diff
      if (originalContent !== modifiedContent) {
        changes.push({
          filePath,
          originalContent,
          modifiedContent,
        });
      }
    }

    return changes;
  }

  /**
   * Saves all changes to disk
   */
  async saveChanges(): Promise<void> {
    await this.project.save();
  }

  /**
   * Finds a symbol (class, function, variable, interface, type alias) by name
   */
  findSymbol(name: string, filePath?: string): Node | undefined {
    const sourceFiles = filePath
      ? [this.getSourceFileOrThrow(filePath)]
      : this.getAllSourceFiles();

    for (const sourceFile of sourceFiles) {
      // Check classes
      const classDecl = sourceFile.getClass(name);
      if (classDecl) return classDecl;

      // Check interfaces
      const interfaceDecl = sourceFile.getInterface(name);
      if (interfaceDecl) return interfaceDecl;

      // Check functions
      const funcDecl = sourceFile.getFunction(name);
      if (funcDecl) return funcDecl;

      // Check type aliases
      const typeAlias = sourceFile.getTypeAlias(name);
      if (typeAlias) return typeAlias;

      // Check enums
      const enumDecl = sourceFile.getEnum(name);
      if (enumDecl) return enumDecl;

      // Check variables
      const varStmt = sourceFile.getVariableStatement((v) =>
        v.getDeclarations().some((d) => d.getName() === name)
      );
      if (varStmt) {
        const decl = varStmt.getDeclarations().find((d) => d.getName() === name);
        if (decl) return decl;
      }
    }

    return undefined;
  }

  /**
   * Gets all references to a symbol
   */
  findReferences(node: Node): Node[] {
    const references: Node[] = [];

    if (Node.isReferenceFindable(node)) {
      const refSymbols = node.findReferences();
      for (const refSymbol of refSymbols) {
        for (const ref of refSymbol.getReferences()) {
          references.push(ref.getNode());
        }
      }
    }

    return references;
  }
}

/**
 * Creates a ts-morph client with change tracking for dry-run support
 */
export class TsMorphClientWithTracking {
  private project: Project;
  private originalContents: Map<string, string> = new Map();

  constructor(tsconfigPath: string) {
    const resolved = resolve(tsconfigPath);

    if (!existsSync(resolved)) {
      throw new Error(`tsconfig.json not found at: ${resolved}`);
    }

    this.project = new Project({
      tsConfigFilePath: resolved,
    });

    // Store original contents
    for (const sourceFile of this.project.getSourceFiles()) {
      this.originalContents.set(sourceFile.getFilePath(), sourceFile.getFullText());
    }
  }

  getProject(): Project {
    return this.project;
  }

  getSourceFile(filePath: string): SourceFile | undefined {
    const resolved = resolve(filePath);
    return this.project.getSourceFile(resolved);
  }

  getSourceFileOrThrow(filePath: string): SourceFile {
    const sourceFile = this.getSourceFile(filePath);
    if (!sourceFile) {
      throw new Error(`Source file not found: ${filePath}`);
    }
    return sourceFile;
  }

  getAllSourceFiles(): SourceFile[] {
    return this.project.getSourceFiles();
  }

  /**
   * Collects all changes by comparing current state to original
   */
  collectChanges(): FileChange[] {
    const changes: FileChange[] = [];

    for (const sourceFile of this.project.getSourceFiles()) {
      const filePath = sourceFile.getFilePath();
      const originalContent = this.originalContents.get(filePath) || '';
      const modifiedContent = sourceFile.getFullText();

      if (originalContent !== modifiedContent) {
        changes.push({
          filePath,
          originalContent,
          modifiedContent,
        });
      }
    }

    return changes;
  }

  /**
   * Saves all changes to disk
   */
  async saveChanges(): Promise<void> {
    await this.project.save();
  }

  /**
   * Finds a symbol by name
   */
  findSymbol(name: string, filePath?: string): Node | undefined {
    const sourceFiles = filePath
      ? [this.getSourceFileOrThrow(filePath)]
      : this.getAllSourceFiles();

    for (const sourceFile of sourceFiles) {
      const classDecl = sourceFile.getClass(name);
      if (classDecl) return classDecl;

      const interfaceDecl = sourceFile.getInterface(name);
      if (interfaceDecl) return interfaceDecl;

      const funcDecl = sourceFile.getFunction(name);
      if (funcDecl) return funcDecl;

      const typeAlias = sourceFile.getTypeAlias(name);
      if (typeAlias) return typeAlias;

      const enumDecl = sourceFile.getEnum(name);
      if (enumDecl) return enumDecl;

      const varStmt = sourceFile.getVariableStatement((v) =>
        v.getDeclarations().some((d) => d.getName() === name)
      );
      if (varStmt) {
        const decl = varStmt.getDeclarations().find((d) => d.getName() === name);
        if (decl) return decl;
      }
    }

    return undefined;
  }
}
