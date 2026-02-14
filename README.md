# Refactor MCP

A Model Context Protocol (MCP) server for automated refactoring of Java and TypeScript/JavaScript codebases. Uses [OpenRewrite](https://docs.openrewrite.org/) for Java refactoring and [ts-morph](https://ts-morph.com/) for TypeScript.

## Features

### Java Refactoring (via OpenRewrite)
- **Rename class** - Rename a class and update all references across the codebase
- **Rename method** - Rename a method and update all call sites
- **Rename field** - Rename a field and update all usages
- **Move class** - Move class(es) to a different package and update imports
- **Add/Remove/Reorder parameters** - Modify method signatures and update all call sites
- **Java Record support** - Full support for modifying Java record components (adds `null` to call sites)

### TypeScript/JavaScript Refactoring (via ts-morph)
- **Rename symbol** - Rename any symbol (class, function, variable, interface, type) and update all references
- **Move symbol** - Move a symbol to a different file and update all imports
- **Rename file** - Rename/move a file and update all imports
- **Extract function** - Extract a code block into a new function with automatic parameter detection
- **Add/Remove parameters** - Modify function signatures and update all call sites

### Utilities
- **Detect project type** - Automatically detect Java/TypeScript projects and their build systems

## Requirements

- Node.js 18+
- For Java refactoring: Maven or Gradle project with OpenRewrite plugin available

## Installation

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/refactor-mcp.git
cd refactor-mcp

# Install dependencies
npm install

# Build
npm run build
```

## Configuration

### Claude Code / Claude Desktop

Add to your Claude configuration file:

**Claude Code** (`~/.claude/settings.json`):
```json
{
  "mcpServers": {
    "refactor": {
      "command": "node",
      "args": ["/path/to/refactor-mcp/build/index.js"]
    }
  }
}
```

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):
```json
{
  "mcpServers": {
    "refactor": {
      "command": "node",
      "args": ["/path/to/refactor-mcp/build/index.js"]
    }
  }
}
```

### Java Projects

For Java refactoring to work, your project needs the OpenRewrite Maven plugin in `pom.xml`:

```xml
<build>
    <plugins>
        <plugin>
            <groupId>org.openrewrite.maven</groupId>
            <artifactId>rewrite-maven-plugin</artifactId>
            <version>5.44.0</version>
        </plugin>
    </plugins>
</build>
```

Or for Gradle, add to `build.gradle`:

```groovy
plugins {
    id 'org.openrewrite.rewrite' version '6.25.0'
}
```

## Usage

All tools support a `dryRun` parameter (default: `true`) that previews changes without applying them.

### Java Examples

**Rename a class:**
```
Rename com.example.UserService to com.example.CustomerService
```

**Rename a method:**
```
Rename method getUser to fetchUser in com.example.UserService
```

**Move classes to a new package:**
```
Move all classes from com.example.old to com.example.new
```

### TypeScript Examples

**Rename a symbol:**
```
Rename UserService to CustomerService in the TypeScript project
```

**Move a symbol to a different file:**
```
Move the UserService class from user-service.ts to services/customer-service.ts
```

**Extract a function:**
```
Extract lines 10-20 from utils.ts into a new function called processData
```

## Available Tools

| Tool | Description |
|------|-------------|
| `detect_project_type` | Detect project type and build system |
| `java_rename_class` | Rename a Java class |
| `java_rename_method` | Rename a Java method |
| `java_rename_field` | Rename a Java field |
| `java_move_class` | Move Java class(es) to a different package |
| `java_add_parameter` | Add a parameter to a Java method |
| `java_remove_parameter` | Remove a parameter from a Java method |
| `java_reorder_parameters` | Reorder parameters in a Java method |
| `typescript_rename_symbol` | Rename any TypeScript symbol |
| `typescript_move_symbol` | Move a symbol to a different file |
| `typescript_rename_file` | Rename/move a TypeScript file |
| `typescript_extract_function` | Extract code into a new function |
| `typescript_add_parameter` | Add a parameter to a function |
| `typescript_remove_parameter` | Remove a parameter from a function |

## Development

```bash
# Run in development mode
npm run dev

# Build
npm run build

# Run tests
npm test
```

## How It Works

### Java Refactoring
The server generates OpenRewrite recipe YAML files dynamically and executes them via the Maven/Gradle plugin. This ensures type-safe refactoring with proper handling of imports, references, and edge cases.

### TypeScript Refactoring
Uses ts-morph to parse and manipulate the TypeScript AST directly. Changes are tracked and can be previewed as diffs before applying.

## Java Records Support

Java records require special handling because they have implicit canonical constructors. When you modify a record's components, **both the record declaration AND all call sites** (`new RecordName(...)`) must be updated.

### How Record Modification Works

When you use `java_add_parameter`, `java_remove_parameter`, or `java_change_method_signature` on a Java record (with `methodName: "<init>"` or the class name), the tool:

1. **Detects the record** - Automatically identifies if the target class is a Java record
2. **Modifies the record declaration** - Updates the record component list directly in the source file
3. **Updates all call sites** - Uses OpenRewrite's `AddNullMethodArgument` recipe to add `null` to all `new RecordName(...)` expressions

### Example: Adding a Component to a Record

```java
// Before: public record Person(String name, int age) {}
// After:  public record Person(String name, int age, String email) {}

// All call sites are updated:
// Before: new Person("John", 30)
// After:  new Person("John", 30, null)
```

### Important Notes for Records

- **New parameters are added as `null`** - When adding a component, all existing call sites receive `null` as the new argument value. You may need to update these manually if a different default is required.
- **Use `<init>` or `<constructor>` as methodName** - Both work for targeting record constructors
- **Dry run first** - Always use `dryRun: true` to preview changes before applying

## Technical Details: OpenRewrite Recipes

Understanding which OpenRewrite recipes are used helps when troubleshooting or extending the tool.

### Declarations vs Call Sites

OpenRewrite has different recipes for modifying **declarations** (where methods/constructors are defined) vs **call sites** (where they are invoked):

| What to Modify | Recipe | Handles |
|----------------|--------|---------|
| Method declaration (add param to signature) | `AddMethodParameter` | Declarations only |
| Method/constructor calls (add argument) | `AddNullMethodArgument` | Call sites (including `new`) |
| Method/constructor calls (add literal) | `AddLiteralMethodArgument` | Call sites (including `new`) |
| Method/constructor calls (remove argument) | `DeleteMethodArgument` | Call sites (including `new`) |
| Method/constructor calls (reorder args) | `ReorderMethodArguments` | Call sites (including `new`) |

### Recipe Selection by Operation

| Tool Operation | Regular Methods | Java Records |
|----------------|-----------------|--------------|
| Add parameter | `AddMethodParameter` | Record utils + `AddNullMethodArgument` |
| Remove parameter | `DeleteMethodArgument` | Record utils + `DeleteMethodArgument` |
| Reorder parameters | `ReorderMethodArguments` | Record utils + `ReorderMethodArguments` |
| Batch changes | `ChangeMethodSignature` composite | Record utils + `UpdateCallSites` composite |

### Method Patterns for Constructors

To target constructors in method patterns, use either:
- `com.example.MyClass <constructor>(..)` - Recommended
- `com.example.MyClass <init>(..)` - Also works

Both patterns match `new MyClass(...)` expressions when used with call-site recipes.

## License

MIT
