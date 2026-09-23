import test from 'node:test';
import assert from 'node:assert/strict';
import { ConstitutionalEngineeringSpecSchema } from '../runtime/constitutional-execution.js';

test('constitutional engineering refuses absolute and traversal target paths', () => {
  const base = {
    schema_version: 1 as const,
    operation: 'CREATE' as const,
    expected_exports: ['proof'],
    verification_commands: ['TYPECHECK'] as ['TYPECHECK'],
    max_files_changed: 1 as const,
    network: false as const,
    credentials: false as const,
    external_messages: false as const,
    deployment: false as const,
    dependency_installation: false as const,
    destructive_operations: false as const
  };
  assert.throws(
    () => ConstitutionalEngineeringSpecSchema.parse({ ...base, target_path: '../outside.ts' })
  );
  assert.throws(
    () => ConstitutionalEngineeringSpecSchema.parse({ ...base, target_path: '/tmp/outside.ts' })
  );
  assert.doesNotThrow(
    () => ConstitutionalEngineeringSpecSchema.parse({ ...base, target_path: 'runtime/proof.ts' })
  );
});
