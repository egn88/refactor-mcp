/**
 * Builds OpenRewrite recipe YAML for various refactoring operations
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
 * Creates a recipe to add a method parameter
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
 * Creates a recipe to delete a method argument
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
 * Creates a recipe to reorder method arguments
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
