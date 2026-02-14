/**
 * Builds OpenRewrite recipe YAML for various refactoring operations.
 *
 * ## Important: Declarations vs Call Sites
 *
 * OpenRewrite has different recipes for different purposes. Understanding the
 * distinction is crucial for correct refactoring:
 *
 * ### Declaration Recipes (modify where methods are defined)
 * - `AddMethodParameter` - Adds parameter to method/constructor DECLARATION only
 *
 * ### Call Site Recipes (modify where methods are called)
 * - `AddNullMethodArgument` - Adds null argument to method calls AND `new ClassName(...)` expressions
 * - `AddLiteralMethodArgument` - Adds literal argument to method calls AND `new ClassName(...)` expressions
 * - `DeleteMethodArgument` - Removes argument from method calls AND `new ClassName(...)` expressions
 * - `ReorderMethodArguments` - Reorders arguments in method calls AND `new ClassName(...)` expressions
 *
 * ### Recipe Selection Guide
 *
 * | Scenario | Recipe to Use |
 * |----------|---------------|
 * | Add param to regular method | `buildAddMethodParameterRecipe` (declaration) |
 * | Add param to Java record | Record utils + `buildAddNullMethodArgumentRecipe` (call sites) |
 * | Remove param (any) | `buildDeleteMethodArgumentRecipe` (handles both) |
 * | Reorder params (any) | `buildReorderMethodArgumentsRecipe` (handles both) |
 * | Batch changes to regular method | `buildChangeMethodSignatureRecipe` |
 * | Batch changes to record call sites | `buildUpdateCallSitesRecipe` |
 *
 * ### Constructor Patterns
 *
 * To target constructors, use either of these method names in your pattern:
 * - `<constructor>` - Recommended for clarity
 * - `<init>` - Also works (JVM internal name)
 *
 * Example: `com.example.MyClass <constructor>(String, int)` matches `new MyClass("a", 1)`
 */

export interface RecipeOptions {
  name?: string;
  displayName?: string;
  description?: string;
}

/**
 * Creates a recipe to rename a class (change fully qualified type name)
 */
export function buildChangeTypeRecipe(
  oldFullyQualifiedName: string,
  newFullyQualifiedName: string,
  options: RecipeOptions = {}
): string {
  return `
type: specs.openrewrite.org/v1beta/recipe
name: ${options.name || 'com.custom.RenameClass'}
displayName: ${options.displayName || 'Rename Class'}
description: ${options.description || `Rename ${oldFullyQualifiedName} to ${newFullyQualifiedName}`}
recipeList:
  - org.openrewrite.java.ChangeType:
      oldFullyQualifiedTypeName: ${oldFullyQualifiedName}
      newFullyQualifiedTypeName: ${newFullyQualifiedName}
`.trim();
}

/**
 * Creates a recipe to rename a method
 */
export function buildChangeMethodNameRecipe(
  methodPattern: string,
  newMethodName: string,
  options: RecipeOptions = {}
): string {
  return `
type: specs.openrewrite.org/v1beta/recipe
name: ${options.name || 'com.custom.RenameMethod'}
displayName: ${options.displayName || 'Rename Method'}
description: ${options.description || `Rename method to ${newMethodName}`}
recipeList:
  - org.openrewrite.java.ChangeMethodName:
      methodPattern: ${methodPattern}
      newMethodName: ${newMethodName}
      matchOverrides: true
`.trim();
}

/**
 * Creates a recipe to change package (move class)
 */
export function buildChangePackageRecipe(
  oldPackageName: string,
  newPackageName: string,
  recursive: boolean = true,
  options: RecipeOptions = {}
): string {
  return `
type: specs.openrewrite.org/v1beta/recipe
name: ${options.name || 'com.custom.MoveClass'}
displayName: ${options.displayName || 'Move Class'}
description: ${options.description || `Move from ${oldPackageName} to ${newPackageName}`}
recipeList:
  - org.openrewrite.java.ChangePackage:
      oldPackageName: ${oldPackageName}
      newPackageName: ${newPackageName}
      recursive: ${recursive}
`.trim();
}

/**
 * Creates a recipe to add a parameter to a method DECLARATION.
 *
 * **IMPORTANT**: This recipe ONLY modifies the method declaration itself.
 * It does NOT update call sites (method invocations or `new ClassName(...)`).
 *
 * For Java records or when you need to update call sites, use:
 * - `buildAddNullMethodArgumentRecipe()` for adding null to call sites
 * - `buildAddLiteralMethodArgumentRecipe()` for adding literal values to call sites
 *
 * @param methodPattern - Pattern like "com.example.MyClass methodName(String, int)"
 * @param parameterType - Type of the new parameter (e.g., "String", "int")
 * @param parameterName - Name of the new parameter
 * @param parameterIndex - Optional 0-based position for the parameter (default: end)
 */
export function buildAddMethodParameterRecipe(
  methodPattern: string,
  parameterType: string,
  parameterName: string,
  parameterIndex?: number,
  options: RecipeOptions = {}
): string {
  const indexLine = parameterIndex !== undefined ? `\n      parameterIndex: ${parameterIndex}` : '';

  return `
type: specs.openrewrite.org/v1beta/recipe
name: ${options.name || 'com.custom.AddParameter'}
displayName: ${options.displayName || 'Add Method Parameter'}
description: ${options.description || `Add parameter ${parameterName} to method`}
recipeList:
  - org.openrewrite.java.AddMethodParameter:
      methodPattern: ${methodPattern}
      parameterType: ${parameterType}
      parameterName: ${parameterName}${indexLine}
`.trim();
}

/**
 * Creates a recipe to delete an argument from method/constructor CALL SITES.
 *
 * This recipe handles BOTH:
 * - Method invocations: `object.method(arg1, arg2)` → `object.method(arg1)`
 * - Constructor calls: `new MyClass(arg1, arg2)` → `new MyClass(arg1)`
 *
 * Use this for both regular methods and Java records.
 *
 * @param methodPattern - Pattern like "com.example.MyClass methodName(String, int)"
 *                        For constructors: "com.example.MyClass <constructor>(String, int)"
 * @param argumentIndex - 0-based index of argument to remove
 */
export function buildDeleteMethodArgumentRecipe(
  methodPattern: string,
  argumentIndex: number,
  options: RecipeOptions = {}
): string {
  return `
type: specs.openrewrite.org/v1beta/recipe
name: ${options.name || 'com.custom.RemoveParameter'}
displayName: ${options.displayName || 'Remove Method Parameter'}
description: ${options.description || `Remove parameter at index ${argumentIndex}`}
recipeList:
  - org.openrewrite.java.DeleteMethodArgument:
      methodPattern: ${methodPattern}
      argumentIndex: ${argumentIndex}
`.trim();
}

/**
 * Creates a recipe to reorder arguments in method/constructor CALL SITES.
 *
 * This recipe handles BOTH:
 * - Method invocations: `object.method(a, b)` → `object.method(b, a)`
 * - Constructor calls: `new MyClass(a, b)` → `new MyClass(b, a)`
 *
 * Use this for both regular methods and Java records.
 *
 * @param methodPattern - Pattern like "com.example.MyClass methodName(String, int)"
 *                        For constructors: "com.example.MyClass <constructor>(String, int)"
 * @param newParameterNames - Array of parameter names in desired order
 * @param oldParameterNames - Optional: original parameter names (for validation)
 */
export function buildReorderMethodArgumentsRecipe(
  methodPattern: string,
  newParameterNames: string[],
  oldParameterNames?: string[],
  options: RecipeOptions = {}
): string {
  const oldParamLine = oldParameterNames
    ? `\n      oldParameterNames: [${oldParameterNames.join(', ')}]`
    : '';

  return `
type: specs.openrewrite.org/v1beta/recipe
name: ${options.name || 'com.custom.ReorderParameters'}
displayName: ${options.displayName || 'Reorder Method Parameters'}
description: ${options.description || 'Reorder method parameters'}
recipeList:
  - org.openrewrite.java.ReorderMethodArguments:
      methodPattern: ${methodPattern}
      newParameterNames: [${newParameterNames.join(', ')}]${oldParamLine}
`.trim();
}

/**
 * Creates a recipe to rename a field using text-based find and replace.
 * Note: OpenRewrite doesn't have a dedicated field rename recipe, so we use
 * a scoped text replacement approach. This works for simple cases but may need
 * manual verification for complex scenarios.
 */
export function buildRenameFieldRecipe(
  fullyQualifiedClassName: string,
  oldFieldName: string,
  newFieldName: string,
  options: RecipeOptions = {}
): string {
  // Extract simple class name for scoping
  const simpleClassName = fullyQualifiedClassName.split('.').pop() || fullyQualifiedClassName;

  // Use FindAndReplace with regex to rename the field and its usages
  // This approach uses word boundary matching to avoid partial replacements
  return `
type: specs.openrewrite.org/v1beta/recipe
name: ${options.name || 'com.custom.RenameField'}
displayName: ${options.displayName || 'Rename Field'}
description: ${options.description || `Rename field ${oldFieldName} to ${newFieldName} in ${simpleClassName}`}
recipeList:
  - org.openrewrite.text.FindAndReplace:
      find: \\b${oldFieldName}\\b
      replace: ${newFieldName}
      filePattern: "**/${simpleClassName}.java"
      regex: true
`.trim();
}

/**
 * Helper to create a method pattern string
 * @param className Fully qualified class name (e.g., "com.example.MyClass")
 * @param methodName Method name
 * @param parameterTypes Array of parameter types (e.g., ["String", "int"])
 */
export function createMethodPattern(
  className: string,
  methodName: string,
  parameterTypes: string[] = []
): string {
  const params = parameterTypes.length > 0 ? parameterTypes.join(', ') : '..';
  return `${className} ${methodName}(${params})`;
}

/**
 * Creates a recipe to add a null argument to method/constructor CALL SITES.
 *
 * This recipe handles BOTH:
 * - Method invocations: `object.method(a)` → `object.method(a, null)`
 * - Constructor calls: `new MyClass(a)` → `new MyClass(a, null)`
 *
 * **USE THIS FOR JAVA RECORDS** when adding components. The record declaration
 * should be modified separately using record-utils, then this recipe updates all
 * `new RecordName(...)` expressions.
 *
 * Unlike `buildAddMethodParameterRecipe()` which only modifies declarations,
 * this recipe finds and updates all call sites across the codebase.
 *
 * @param methodPattern - Pattern like "com.example.MyClass methodName(String, int)"
 *                        For constructors: "com.example.MyClass <constructor>(String, int)"
 * @param argumentIndex - 0-based position where null should be inserted
 * @param parameterType - Fully qualified type for the null value (e.g., "java.lang.String")
 * @param parameterName - Name of the parameter (for documentation/metadata)
 */
export function buildAddNullMethodArgumentRecipe(
  methodPattern: string,
  argumentIndex: number,
  parameterType: string,
  parameterName: string,
  options: RecipeOptions = {}
): string {
  return `
type: specs.openrewrite.org/v1beta/recipe
name: ${options.name || 'com.custom.AddNullArgument'}
displayName: ${options.displayName || 'Add Null Method Argument'}
description: ${options.description || `Add null argument for ${parameterName} to method/constructor calls`}
recipeList:
  - org.openrewrite.java.AddNullMethodArgument:
      methodPattern: ${methodPattern}
      argumentIndex: ${argumentIndex}
      parameterType: ${parameterType}
      parameterName: ${parameterName}
`.trim();
}

/**
 * Creates a recipe to add a literal argument to method/constructor CALL SITES.
 *
 * This recipe handles BOTH:
 * - Method invocations: `object.method(a)` → `object.method(a, "value")`
 * - Constructor calls: `new MyClass(a)` → `new MyClass(a, "value")`
 *
 * Use this when you need to add a specific default value (not null) to call sites.
 * For null values, use `buildAddNullMethodArgumentRecipe()` instead.
 *
 * @param methodPattern - Pattern like "com.example.MyClass methodName(String, int)"
 *                        For constructors: "com.example.MyClass <constructor>(String, int)"
 * @param argumentIndex - 0-based position where the literal should be inserted
 * @param literal - The literal value to insert (e.g., "defaultValue", "0", "true")
 * @param primitiveType - Type of the literal: 'String' | 'int' | 'short' | 'long' | 'float' | 'double' | 'boolean' | 'char'
 */
export function buildAddLiteralMethodArgumentRecipe(
  methodPattern: string,
  argumentIndex: number,
  literal: string,
  primitiveType: 'String' | 'int' | 'short' | 'long' | 'float' | 'double' | 'boolean' | 'char' = 'String',
  options: RecipeOptions = {}
): string {
  return `
type: specs.openrewrite.org/v1beta/recipe
name: ${options.name || 'com.custom.AddLiteralArgument'}
displayName: ${options.displayName || 'Add Literal Method Argument'}
description: ${options.description || `Add literal argument to method/constructor calls`}
recipeList:
  - org.openrewrite.java.AddLiteralMethodArgument:
      methodPattern: ${methodPattern}
      argumentIndex: ${argumentIndex}
      literal: ${literal}
      primitiveType: ${primitiveType}
`.trim();
}

/**
 * Combines multiple recipes into a single composite recipe
 */
export function buildCompositeRecipe(
  recipes: string[],
  options: RecipeOptions = {}
): string {
  const recipeListItems = recipes.map((recipe) => {
    // Extract the recipe name from each YAML
    const nameMatch = recipe.match(/name:\s*(.+)/);
    const name = nameMatch ? nameMatch[1].trim() : 'unknown';
    return `  - ${name}`;
  }).join('\n');

  return `
type: specs.openrewrite.org/v1beta/recipe
name: ${options.name || 'com.custom.CompositeRecipe'}
displayName: ${options.displayName || 'Composite Recipe'}
description: ${options.description || 'Combined refactoring operations'}
recipeList:
${recipeListItems}
`.trim();
}

/**
 * Parameter to add in a signature change
 */
export interface ParameterToAdd {
  type: string;
  name: string;
  index?: number;
}

/**
 * Builds a composite recipe for changing method DECLARATIONS with multiple operations.
 *
 * **NOTE**: This recipe uses `AddMethodParameter` for additions, which ONLY modifies
 * declarations. For Java records or when call sites need updating, use
 * `buildUpdateCallSitesRecipe()` instead.
 *
 * Operations are executed in order:
 * 1. Remove parameters (from highest to lowest index to avoid shifting issues)
 * 2. Add parameters to declarations
 * 3. Reorder parameters (optional)
 *
 * @param methodPattern - Pattern like "com.example.MyClass methodName(String, int)"
 * @param parametersToAdd - Array of parameters to add with type, name, and optional index
 * @param parameterIndicesToRemove - Array of 0-based indices to remove (processed first)
 * @param newParameterOrder - Optional: final order of parameter names after all operations
 */
export function buildChangeMethodSignatureRecipe(
  methodPattern: string,
  parametersToAdd: ParameterToAdd[] = [],
  parameterIndicesToRemove: number[] = [],
  newParameterOrder?: string[],
  options: RecipeOptions = {}
): string {
  const recipeItems: string[] = [];
  let recipeIndex = 0;

  // Sort removal indices from highest to lowest to avoid index shifting
  const sortedRemovalIndices = [...parameterIndicesToRemove].sort((a, b) => b - a);

  // Add removal recipes first (highest index first)
  for (const index of sortedRemovalIndices) {
    recipeItems.push(`  - org.openrewrite.java.DeleteMethodArgument:
      methodPattern: ${methodPattern}
      argumentIndex: ${index}`);
    recipeIndex++;
  }

  // Add parameter addition recipes
  for (const param of parametersToAdd) {
    const indexLine = param.index !== undefined ? `\n      parameterIndex: ${param.index}` : '';
    recipeItems.push(`  - org.openrewrite.java.AddMethodParameter:
      methodPattern: ${methodPattern}
      parameterType: ${param.type}
      parameterName: ${param.name}${indexLine}`);
    recipeIndex++;
  }

  // Add reorder recipe if specified
  if (newParameterOrder && newParameterOrder.length > 0) {
    recipeItems.push(`  - org.openrewrite.java.ReorderMethodArguments:
      methodPattern: ${methodPattern}
      newParameterNames: [${newParameterOrder.join(', ')}]`);
  }

  return `
type: specs.openrewrite.org/v1beta/recipe
name: ${options.name || 'com.custom.ChangeMethodSignature'}
displayName: ${options.displayName || 'Change Method Signature'}
description: ${options.description || 'Change method signature with multiple operations'}
recipeList:
${recipeItems.join('\n')}
`.trim();
}

/**
 * Parameter to add to call sites (method invocations and constructor calls)
 */
export interface CallSiteParameterToAdd {
  type: string;
  name: string;
  index: number;
}

/**
 * Builds a composite recipe for updating CALL SITES (method invocations and constructor calls).
 *
 * **USE THIS FOR JAVA RECORDS** and any scenario where call sites need updating.
 * This is different from `buildChangeMethodSignatureRecipe()` which only modifies declarations.
 *
 * This recipe updates:
 * - Method invocations: `object.method(a, b)`
 * - Constructor calls: `new MyClass(a, b)`
 *
 * Operations are executed in order:
 * 1. Remove arguments (from highest to lowest index to avoid shifting issues)
 * 2. Add null arguments at specified positions
 * 3. Reorder arguments (optional)
 *
 * @param methodPattern - Pattern like "com.example.MyClass methodName(String, int)"
 *                        For constructors: "com.example.MyClass <constructor>(String, int)"
 * @param parametersToAdd - Array of parameters to add with type, name, and REQUIRED index
 * @param argumentIndicesToRemove - Array of 0-based indices to remove (processed first)
 * @param newParameterOrder - Optional: final order of parameter names after all operations
 */
export function buildUpdateCallSitesRecipe(
  methodPattern: string,
  parametersToAdd: CallSiteParameterToAdd[] = [],
  argumentIndicesToRemove: number[] = [],
  newParameterOrder?: string[],
  options: RecipeOptions = {}
): string {
  const recipeItems: string[] = [];

  // Sort removal indices from highest to lowest to avoid index shifting
  const sortedRemovalIndices = [...argumentIndicesToRemove].sort((a, b) => b - a);

  // Add removal recipes first (highest index first)
  for (const index of sortedRemovalIndices) {
    recipeItems.push(`  - org.openrewrite.java.DeleteMethodArgument:
      methodPattern: ${methodPattern}
      argumentIndex: ${index}`);
  }

  // Add null argument addition recipes (uses AddNullMethodArgument which updates call sites)
  // Sort by index to add in correct order
  const sortedParamsToAdd = [...parametersToAdd].sort((a, b) => a.index - b.index);
  for (const param of sortedParamsToAdd) {
    recipeItems.push(`  - org.openrewrite.java.AddNullMethodArgument:
      methodPattern: ${methodPattern}
      argumentIndex: ${param.index}
      parameterType: ${param.type}
      parameterName: ${param.name}`);
  }

  // Add reorder recipe if specified
  if (newParameterOrder && newParameterOrder.length > 0) {
    recipeItems.push(`  - org.openrewrite.java.ReorderMethodArguments:
      methodPattern: ${methodPattern}
      newParameterNames: [${newParameterOrder.join(', ')}]`);
  }

  return `
type: specs.openrewrite.org/v1beta/recipe
name: ${options.name || 'com.custom.UpdateCallSites'}
displayName: ${options.displayName || 'Update Call Sites'}
description: ${options.description || 'Update method/constructor call sites with new arguments'}
recipeList:
${recipeItems.join('\n')}
`.trim();
}
