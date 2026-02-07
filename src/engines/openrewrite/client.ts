import { exec, execSync, spawn } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { promisify } from 'util';
import { Config } from '../../config.js';

const execAsync = promisify(exec);

export interface OpenRewriteResult {
  success: boolean;
  message: string;
  diff?: string;
  errors?: string[];
  filesChanged?: number;
}

export class OpenRewriteClient {
  private config: Config;
  private modCliPath: string;

  constructor(config: Config) {
    this.config = config;
    this.modCliPath = config.modCliPath;
  }

  /**
   * Checks if the Moderne CLI is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      await execAsync(`${this.modCliPath} --version`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Gets the Moderne CLI version
   */
  async getVersion(): Promise<string | null> {
    try {
      const { stdout } = await execAsync(`${this.modCliPath} --version`);
      return stdout.trim();
    } catch {
      return null;
    }
  }

  /**
   * Executes an OpenRewrite recipe on a project
   */
  async runRecipe(
    projectPath: string,
    recipeYaml: string,
    dryRun: boolean = true
  ): Promise<OpenRewriteResult> {
    const resolvedPath = resolve(projectPath);

    if (!existsSync(resolvedPath)) {
      return {
        success: false,
        message: `Project path does not exist: ${resolvedPath}`,
      };
    }

    // Check if mod CLI is available
    if (!(await this.isAvailable())) {
      return {
        success: false,
        message: `Moderne CLI not found. Please install it or set MOD_CLI_PATH in environment.`,
      };
    }

    // Create a temporary directory for the recipe file
    const tempDir = join(tmpdir(), `openrewrite-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });

    const recipeFile = join(tempDir, 'recipe.yml');
    writeFileSync(recipeFile, recipeYaml, 'utf-8');

    try {
      // Build the project first to ensure the LST is up to date
      const buildResult = await this.buildProject(resolvedPath);
      if (!buildResult.success) {
        return buildResult;
      }

      // Run the recipe
      const args = [
        'run',
        '--recipe-file', recipeFile,
        '--project', resolvedPath,
      ];

      if (dryRun) {
        args.push('--dry-run');
      }

      const result = await this.executeCommand(args);

      // Parse the output
      const filesChanged = this.parseFilesChanged(result.stdout);
      const diff = dryRun ? this.extractDiff(result.stdout) : undefined;

      return {
        success: true,
        message: dryRun
          ? `Dry run completed. ${filesChanged} file(s) would be changed.`
          : `Recipe executed. ${filesChanged} file(s) changed.`,
        diff,
        filesChanged,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: `Failed to execute recipe: ${errorMessage}`,
        errors: [errorMessage],
      };
    } finally {
      // Cleanup temp directory
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Extracts the recipe name from the recipe YAML
   */
  private extractRecipeName(recipeYaml: string): string {
    const match = recipeYaml.match(/^name:\s*(.+)$/m);
    return match ? match[1].trim() : 'com.custom.Recipe';
  }

  /**
   * Runs an inline OpenRewrite recipe using Maven/Gradle plugin
   * This is an alternative approach that doesn't require the Moderne CLI
   */
  async runRecipeWithBuildTool(
    projectPath: string,
    recipeYaml: string,
    dryRun: boolean = true
  ): Promise<OpenRewriteResult> {
    const resolvedPath = resolve(projectPath);

    if (!existsSync(resolvedPath)) {
      return {
        success: false,
        message: `Project path does not exist: ${resolvedPath}`,
      };
    }

    // Detect build system
    const buildSystem = this.detectBuildSystem(resolvedPath);

    if (!buildSystem) {
      return {
        success: false,
        message: 'Could not detect build system (Maven or Gradle)',
      };
    }

    // Extract recipe name from YAML
    const recipeName = this.extractRecipeName(recipeYaml);

    // Create a temporary rewrite.yml file in the project
    const rewriteFile = join(resolvedPath, 'rewrite.yml');
    const backupFile = existsSync(rewriteFile) ? readFileSync(rewriteFile, 'utf-8') : null;

    try {
      writeFileSync(rewriteFile, recipeYaml, 'utf-8');

      let command: string;
      let args: string[];

      if (buildSystem === 'maven') {
        command = 'mvn';
        // Pass the recipe name via -Drewrite.activeRecipes to activate it
        args = [
          `-Drewrite.activeRecipes=${recipeName}`,
          dryRun
            ? 'org.openrewrite.maven:rewrite-maven-plugin:dryRun'
            : 'org.openrewrite.maven:rewrite-maven-plugin:run',
        ];
      } else {
        command = './gradlew';
        // For Gradle, we need to pass the recipe name differently
        args = [
          `-Drewrite.activeRecipe=${recipeName}`,
          dryRun ? 'rewriteDryRun' : 'rewriteRun',
        ];
      }

      const result = await this.executeCommandInDir(command, args, resolvedPath);

      const combinedOutput = result.stdout + result.stderr;

      // Check for recipe validation errors
      const recipeError = this.extractRecipeError(combinedOutput);
      if (recipeError) {
        return {
          success: false,
          message: recipeError,
          filesChanged: 0,
          errors: [recipeError],
        };
      }

      const filesChanged = this.parseFilesChanged(combinedOutput);
      const diff = dryRun ? this.extractDiff(combinedOutput) : undefined;

      return {
        success: true,
        message: dryRun
          ? `Dry run completed. ${filesChanged} file(s) would be changed.`
          : `Recipe executed. ${filesChanged} file(s) changed.`,
        diff,
        filesChanged,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: `Failed to execute recipe: ${errorMessage}`,
        errors: [errorMessage],
      };
    } finally {
      // Restore or remove the rewrite.yml file
      if (backupFile !== null) {
        writeFileSync(rewriteFile, backupFile, 'utf-8');
      } else if (existsSync(rewriteFile)) {
        rmSync(rewriteFile);
      }
    }
  }

  private async buildProject(projectPath: string): Promise<OpenRewriteResult> {
    const buildSystem = this.detectBuildSystem(projectPath);

    if (!buildSystem) {
      return {
        success: false,
        message: 'Could not detect build system',
      };
    }

    try {
      if (buildSystem === 'maven') {
        await this.executeCommandInDir('mvn', ['compile', '-q'], projectPath);
      } else {
        await this.executeCommandInDir('./gradlew', ['compileJava', '-q'], projectPath);
      }

      return { success: true, message: 'Build successful' };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: `Build failed: ${errorMessage}`,
        errors: [errorMessage],
      };
    }
  }

  private detectBuildSystem(projectPath: string): 'maven' | 'gradle' | null {
    if (existsSync(join(projectPath, 'pom.xml'))) {
      return 'maven';
    }
    if (existsSync(join(projectPath, 'build.gradle')) ||
        existsSync(join(projectPath, 'build.gradle.kts'))) {
      return 'gradle';
    }
    return null;
  }

  private async executeCommand(args: string[]): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const process = spawn(this.modCliPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      process.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      process.on('close', (code) => {
        if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          reject(new Error(`Command failed with code ${code}: ${stderr || stdout}`));
        }
      });

      process.on('error', (error) => {
        reject(error);
      });
    });
  }

  private async executeCommandInDir(
    command: string,
    args: string[],
    cwd: string
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const process = spawn(command, args, {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true,
      });

      let stdout = '';
      let stderr = '';

      process.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      process.on('close', (code) => {
        if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          reject(new Error(`Command failed with code ${code}: ${stderr || stdout}`));
        }
      });

      process.on('error', (error) => {
        reject(error);
      });
    });
  }

  private extractRecipeError(output: string): string | null {
    // Check for recipe validation errors
    const recipeNotFoundMatch = output.match(/Recipe(?:\s+class)?\s+(\S+)\s+cannot be found/);
    if (recipeNotFoundMatch) {
      return `Recipe not found: ${recipeNotFoundMatch[1]}. This recipe may not be available in the current OpenRewrite version.`;
    }

    const validationErrorMatch = output.match(/Recipe validation error[^:]*:\s*(.+)/);
    if (validationErrorMatch) {
      return `Recipe validation error: ${validationErrorMatch[1]}`;
    }

    const buildFailureMatch = output.match(/BUILD FAILURE[\s\S]*?Failed to execute goal[^:]*:\s*([^\n]+)/);
    if (buildFailureMatch && !output.includes('would make changes to') && !output.includes('would move a file')) {
      return `Build failed: ${buildFailureMatch[1]}`;
    }

    return null;
  }

  private parseFilesChanged(output: string): number {
    // Try to parse the number of files changed from the output
    // Pattern 1: "X file(s) would be changed" or "X file(s) changed"
    const countMatch = output.match(/(\d+)\s+file[s]?\s+(changed|would be changed)/i);
    if (countMatch) {
      return parseInt(countMatch[1], 10);
    }

    // Pattern 2: Count OpenRewrite info/warning lines about changes
    // For dry-run: "would move a file" / "would make changes to"
    // For actual run: "Changes have been made to" / "made changes to"
    const moveMatches = output.match(/(would move a file from|moved file from)/gi);
    const changeMatches = output.match(/(would make changes to|Changes have been made to|made changes to)/gi);
    const moveCount = moveMatches ? moveMatches.length : 0;
    const changeCount = changeMatches ? changeMatches.length : 0;

    return moveCount + changeCount;
  }

  private extractDiff(output: string, projectPath?: string): string {
    // Try to extract the patch file path and read it
    // The output format is: [WARNING] Patch file available:\n[WARNING]     /path/to/file.patch
    const patchMatch = output.match(/Patch file available:[\s\S]*?(\S+\.patch)/);
    if (patchMatch && patchMatch[1]) {
      const patchPath = patchMatch[1].trim();
      try {
        if (existsSync(patchPath)) {
          return readFileSync(patchPath, 'utf-8');
        }
      } catch {
        // Ignore errors reading patch file
      }
    }

    // Fallback: try to extract diff from output directly
    const diffMatch = output.match(/diff --git[\s\S]*/);
    if (diffMatch) {
      return diffMatch[0];
    }

    // Return summary of changes from the output
    const lines = output.split('\n').filter(line =>
      line.includes('would move a file') ||
      line.includes('would make changes to') ||
      line.includes('org.openrewrite')
    );

    return lines.length > 0 ? lines.join('\n') : 'No diff available';
  }
}
