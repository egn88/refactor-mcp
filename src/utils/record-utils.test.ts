import { describe, it, expect } from 'vitest';
import {
  parseRecordFromSource,
  parseRecordComponents,
  addRecordComponent,
  removeRecordComponent,
  reorderRecordComponents,
  RecordComponent,
} from './record-utils.js';

describe('parseRecordComponents', () => {
  it('should parse simple record components', () => {
    const result = parseRecordComponents('String name, int age');
    expect(result).toEqual([
      { type: 'String', name: 'name' },
      { type: 'int', name: 'age' },
    ]);
  });

  it('should parse components with generic types', () => {
    const result = parseRecordComponents('List<String> items, Map<String, Integer> counts');
    expect(result).toEqual([
      { type: 'List<String>', name: 'items' },
      { type: 'Map<String, Integer>', name: 'counts' },
    ]);
  });

  it('should parse components with annotations', () => {
    const result = parseRecordComponents('@NotNull String name, @Min(0) int age');
    expect(result).toEqual([
      { type: 'String', name: 'name', annotations: ['@NotNull'] },
      { type: 'int', name: 'age', annotations: ['@Min(0)'] },
    ]);
  });

  it('should parse components with multiple annotations', () => {
    const result = parseRecordComponents('@NotNull @Size(max=100) String name');
    expect(result).toEqual([
      { type: 'String', name: 'name', annotations: ['@NotNull', '@Size(max=100)'] },
    ]);
  });

  it('should handle empty components', () => {
    const result = parseRecordComponents('');
    expect(result).toEqual([]);
  });

  it('should handle whitespace', () => {
    const result = parseRecordComponents('  String   name  ,   int   age  ');
    expect(result).toEqual([
      { type: 'String', name: 'name' },
      { type: 'int', name: 'age' },
    ]);
  });

  it('should parse nested generic types', () => {
    const result = parseRecordComponents('Map<String, List<Integer>> data');
    expect(result).toEqual([
      { type: 'Map<String, List<Integer>>', name: 'data' },
    ]);
  });
});

describe('parseRecordFromSource', () => {
  it('should detect a simple record', () => {
    const source = `
package com.example;

public record Person(String name, int age) {
}
`;
    const result = parseRecordFromSource(source);
    expect(result.isRecord).toBe(true);
    expect(result.className).toBe('Person');
    expect(result.packageName).toBe('com.example');
    expect(result.components).toEqual([
      { type: 'String', name: 'name' },
      { type: 'int', name: 'age' },
    ]);
  });

  it('should detect a record with annotations', () => {
    const source = `
package com.example;

@Entity
public record Person(String name, int age) {
}
`;
    const result = parseRecordFromSource(source);
    expect(result.isRecord).toBe(true);
    expect(result.className).toBe('Person');
  });

  it('should detect a record without public modifier', () => {
    const source = `
package com.example;

record InternalPerson(String name) {
}
`;
    const result = parseRecordFromSource(source);
    expect(result.isRecord).toBe(true);
    expect(result.className).toBe('InternalPerson');
  });

  it('should not detect a regular class as a record', () => {
    const source = `
package com.example;

public class Person {
    private String name;
}
`;
    const result = parseRecordFromSource(source);
    expect(result.isRecord).toBe(false);
  });

  it('should parse record with generic type components', () => {
    const source = `
package com.example;

public record Container(List<String> items, Map<String, Integer> counts) {
}
`;
    const result = parseRecordFromSource(source);
    expect(result.isRecord).toBe(true);
    expect(result.components).toEqual([
      { type: 'List<String>', name: 'items' },
      { type: 'Map<String, Integer>', name: 'counts' },
    ]);
  });

  it('should parse record with annotated components', () => {
    const source = `
package com.example;

public record Person(@NotNull String name, @Min(0) int age) {
}
`;
    const result = parseRecordFromSource(source);
    expect(result.isRecord).toBe(true);
    expect(result.components).toEqual([
      { type: 'String', name: 'name', annotations: ['@NotNull'] },
      { type: 'int', name: 'age', annotations: ['@Min(0)'] },
    ]);
  });

  it('should handle record with no components', () => {
    const source = `
package com.example;

public record EmptyRecord() {
}
`;
    const result = parseRecordFromSource(source);
    expect(result.isRecord).toBe(true);
    expect(result.className).toBe('EmptyRecord');
    expect(result.components).toEqual([]);
  });
});

describe('addRecordComponent', () => {
  const baseRecord = `
package com.example;

public record Person(String name, int age) {
}
`;

  it('should add a component at the end', () => {
    const result = addRecordComponent(baseRecord, 'String', 'email');
    expect(result.success).toBe(true);
    expect(result.modifiedContent).toContain('public record Person(String name, int age, String email)');
  });

  it('should add a component at the beginning', () => {
    const result = addRecordComponent(baseRecord, 'Long', 'id', 0);
    expect(result.success).toBe(true);
    expect(result.modifiedContent).toContain('public record Person(Long id, String name, int age)');
  });

  it('should add a component in the middle', () => {
    const result = addRecordComponent(baseRecord, 'String', 'middleName', 1);
    expect(result.success).toBe(true);
    expect(result.modifiedContent).toContain('public record Person(String name, String middleName, int age)');
  });

  it('should add a component with annotations', () => {
    const result = addRecordComponent(baseRecord, 'String', 'email', undefined, ['@NotNull']);
    expect(result.success).toBe(true);
    expect(result.modifiedContent).toContain('@NotNull String email');
  });

  it('should add to an empty record', () => {
    const emptyRecord = `
package com.example;

public record EmptyRecord() {
}
`;
    const result = addRecordComponent(emptyRecord, 'String', 'name');
    expect(result.success).toBe(true);
    expect(result.modifiedContent).toContain('public record EmptyRecord(String name)');
  });

  it('should fail on non-record source', () => {
    const classSource = `
package com.example;

public class Person {
    private String name;
}
`;
    const result = addRecordComponent(classSource, 'String', 'email');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Could not find record declaration');
  });

  it('should preserve existing component annotations', () => {
    const annotatedRecord = `
package com.example;

public record Person(@NotNull String name, @Min(0) int age) {
}
`;
    const result = addRecordComponent(annotatedRecord, 'String', 'email');
    expect(result.success).toBe(true);
    expect(result.modifiedContent).toContain('@NotNull String name');
    expect(result.modifiedContent).toContain('@Min(0) int age');
    expect(result.modifiedContent).toContain('String email');
  });
});

describe('removeRecordComponent', () => {
  const baseRecord = `
package com.example;

public record Person(String name, int age, String email) {
}
`;

  it('should remove the first component', () => {
    const result = removeRecordComponent(baseRecord, 0);
    expect(result.success).toBe(true);
    expect(result.modifiedContent).toContain('public record Person(int age, String email)');
  });

  it('should remove the last component', () => {
    const result = removeRecordComponent(baseRecord, 2);
    expect(result.success).toBe(true);
    expect(result.modifiedContent).toContain('public record Person(String name, int age)');
  });

  it('should remove a middle component', () => {
    const result = removeRecordComponent(baseRecord, 1);
    expect(result.success).toBe(true);
    expect(result.modifiedContent).toContain('public record Person(String name, String email)');
  });

  it('should fail with invalid index', () => {
    const result = removeRecordComponent(baseRecord, 5);
    expect(result.success).toBe(false);
    expect(result.error).toContain('out of range');
  });

  it('should fail with negative index', () => {
    const result = removeRecordComponent(baseRecord, -1);
    expect(result.success).toBe(false);
    expect(result.error).toContain('out of range');
  });

  it('should remove from a single-component record', () => {
    const singleComponent = `
package com.example;

public record SingleRecord(String name) {
}
`;
    const result = removeRecordComponent(singleComponent, 0);
    expect(result.success).toBe(true);
    expect(result.modifiedContent).toContain('public record SingleRecord()');
  });

  it('should preserve annotations on remaining components', () => {
    const annotatedRecord = `
package com.example;

public record Person(@NotNull String name, int age, @Email String email) {
}
`;
    const result = removeRecordComponent(annotatedRecord, 1); // Remove 'age'
    expect(result.success).toBe(true);
    expect(result.modifiedContent).toContain('@NotNull String name');
    expect(result.modifiedContent).toContain('@Email String email');
    expect(result.modifiedContent).not.toContain('int age');
  });
});

describe('reorderRecordComponents', () => {
  const baseRecord = `
package com.example;

public record Person(String name, int age, String email) {
}
`;

  it('should reorder components', () => {
    const result = reorderRecordComponents(baseRecord, ['email', 'name', 'age']);
    expect(result.success).toBe(true);
    expect(result.modifiedContent).toContain('public record Person(String email, String name, int age)');
  });

  it('should keep same order when specified', () => {
    const result = reorderRecordComponents(baseRecord, ['name', 'age', 'email']);
    expect(result.success).toBe(true);
    expect(result.modifiedContent).toContain('public record Person(String name, int age, String email)');
  });

  it('should fail when component not found', () => {
    const result = reorderRecordComponents(baseRecord, ['name', 'age', 'nonexistent']);
    expect(result.success).toBe(false);
    expect(result.error).toContain("'nonexistent' not found");
  });

  it('should preserve annotations when reordering', () => {
    const annotatedRecord = `
package com.example;

public record Person(@NotNull String name, @Min(0) int age, @Email String email) {
}
`;
    const result = reorderRecordComponents(annotatedRecord, ['email', 'age', 'name']);
    expect(result.success).toBe(true);
    expect(result.modifiedContent).toContain('@Email String email');
    expect(result.modifiedContent).toContain('@Min(0) int age');
    expect(result.modifiedContent).toContain('@NotNull String name');
    // Verify order
    const emailPos = result.modifiedContent!.indexOf('@Email');
    const agePos = result.modifiedContent!.indexOf('@Min(0)');
    const namePos = result.modifiedContent!.indexOf('@NotNull');
    expect(emailPos).toBeLessThan(agePos);
    expect(agePos).toBeLessThan(namePos);
  });
});

describe('complex record scenarios', () => {
  it('should handle record with implements clause', () => {
    const source = `
package com.example;

public record Person(String name, int age) implements Serializable {
}
`;
    const result = parseRecordFromSource(source);
    expect(result.isRecord).toBe(true);
    expect(result.className).toBe('Person');
    expect(result.components?.length).toBe(2);
  });

  it('should handle record with compact constructor', () => {
    const source = `
package com.example;

public record Person(String name, int age) {
    public Person {
        if (age < 0) throw new IllegalArgumentException();
    }
}
`;
    const result = parseRecordFromSource(source);
    expect(result.isRecord).toBe(true);
    expect(result.components?.length).toBe(2);
  });

  it('should handle multiline record declaration', () => {
    const source = `
package com.example;

public record Person(
    String name,
    int age,
    String email
) {
}
`;
    const result = parseRecordFromSource(source);
    expect(result.isRecord).toBe(true);
    expect(result.components?.length).toBe(3);
  });

  it('should add component to multiline record', () => {
    const source = `
package com.example;

public record Person(
    String name,
    int age
) {
}
`;
    const result = addRecordComponent(source, 'String', 'email');
    expect(result.success).toBe(true);
    expect(result.modifiedContent).toContain('String email');
  });
});
