// Module-scoped read-only flag, kept separate from readOnly.tsx so that api.ts
// can consult it without pulling React and react-router into its module graph.
//
// Refcounted rather than boolean so nesting or a remount can't leave it stuck.

let depth = 0;

export function enterReadOnly(): void {
  depth += 1;
}

export function exitReadOnly(): void {
  depth = Math.max(0, depth - 1);
}

export function isReadOnlyActive(): boolean {
  return depth > 0;
}
