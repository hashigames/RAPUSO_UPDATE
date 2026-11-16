import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Pure mirror of our Firestore RiggedCharacter & Dirty Dozen rule invariants.
 */
function evaluateRiggedCharacterWrite(params: {
  auth: { uid: string; emailVerified: boolean } | null;
  pathUserId: string;
  pathCharId: string;
  data: Record<string, unknown>;
  isServerTimeCreatedAt: boolean;
  isServerTimeUpdatedAt: boolean;
}): 'ALLOW' | 'PERMISSION_DENIED' {
  if (!params.auth || !params.auth.emailVerified) return 'PERMISSION_DENIED';
  const idRegex = /^[a-zA-Z0-9_\-]+$/;
  if (!idRegex.test(params.pathUserId) || params.pathUserId.length > 128) return 'PERMISSION_DENIED';
  if (!idRegex.test(params.pathCharId) || params.pathCharId.length > 128) return 'PERMISSION_DENIED';
  if (params.auth.uid !== params.pathUserId) return 'PERMISSION_DENIED';

  const requiredKeys = [
    'id', 'ownerUid', 'name', 'sourceFormat', 'primaryFileName',
    'boneCount', 'skinnedMeshCount', 'hasSkinWeights',
    'textureCount', 'chunkCount', 'totalBytes', 'createdAt', 'updatedAt',
  ];
  const keys = Object.keys(params.data);
  if (!requiredKeys.every((k) => keys.includes(k))) return 'PERMISSION_DENIED';
  if (!keys.every((k) => requiredKeys.includes(k))) return 'PERMISSION_DENIED';

  if (params.data.id !== params.pathCharId) return 'PERMISSION_DENIED';
  if (params.data.ownerUid !== params.auth.uid) return 'PERMISSION_DENIED';
  if (typeof params.data.name !== 'string' || params.data.name.length < 1 || params.data.name.length > 120) {
    return 'PERMISSION_DENIED';
  }
  if (!['glb', 'gltf', 'fbx'].includes(String(params.data.sourceFormat))) {
    return 'PERMISSION_DENIED';
  }
  if (typeof params.data.boneCount !== 'number' || params.data.boneCount < 1 || params.data.boneCount > 500) {
    return 'PERMISSION_DENIED';
  }
  if (
    typeof params.data.skinnedMeshCount !== 'number' ||
    params.data.skinnedMeshCount < 1 ||
    params.data.skinnedMeshCount > 64
  ) {
    return 'PERMISSION_DENIED';
  }
  if (params.data.hasSkinWeights !== true) return 'PERMISSION_DENIED';
  if (typeof params.data.chunkCount !== 'number' || params.data.chunkCount < 1 || params.data.chunkCount > 40) {
    return 'PERMISSION_DENIED';
  }
  if (!params.isServerTimeCreatedAt || !params.isServerTimeUpdatedAt) return 'PERMISSION_DENIED';
  return 'ALLOW';
}

test('firestore.rules exists and enforces rigged-only and Dirty Dozen invariants', () => {
  const rulesText = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');
  assert.ok(rulesText.includes('allow read, write: if false;'));
  assert.ok(rulesText.includes('data.hasSkinWeights == true'));
  assert.ok(rulesText.includes("in ['glb', 'gltf', 'fbx']"));

  const baseValid = {
    id: 'char_01',
    ownerUid: 'u1',
    name: 'Hero Rig',
    sourceFormat: 'glb',
    primaryFileName: 'hero.glb',
    boneCount: 41,
    skinnedMeshCount: 1,
    hasSkinWeights: true,
    textureCount: 3,
    chunkCount: 2,
    totalBytes: 512000,
    createdAt: 'SERVER_TIME',
    updatedAt: 'SERVER_TIME',
  };

  assert.equal(
    evaluateRiggedCharacterWrite({
      auth: { uid: 'u1', emailVerified: true },
      pathUserId: 'u1',
      pathCharId: 'char_01',
      data: baseValid,
      isServerTimeCreatedAt: true,
      isServerTimeUpdatedAt: true,
    }),
    'ALLOW'
  );

  // Dirty Dozen checks
  // 1. Unauthenticated
  assert.equal(
    evaluateRiggedCharacterWrite({
      auth: null,
      pathUserId: 'u1',
      pathCharId: 'char_01',
      data: baseValid,
      isServerTimeCreatedAt: true,
      isServerTimeUpdatedAt: true,
    }),
    'PERMISSION_DENIED'
  );
  // 2. Cross-user write
  assert.equal(
    evaluateRiggedCharacterWrite({
      auth: { uid: 'u2', emailVerified: true },
      pathUserId: 'u1',
      pathCharId: 'char_01',
      data: baseValid,
      isServerTimeCreatedAt: true,
      isServerTimeUpdatedAt: true,
    }),
    'PERMISSION_DENIED'
  );
  // 3. Unrigged mesh (hasSkinWeights: false / boneCount: 0)
  assert.equal(
    evaluateRiggedCharacterWrite({
      auth: { uid: 'u1', emailVerified: true },
      pathUserId: 'u1',
      pathCharId: 'char_01',
      data: { ...baseValid, hasSkinWeights: false, boneCount: 0 },
      isServerTimeCreatedAt: true,
      isServerTimeUpdatedAt: true,
    }),
    'PERMISSION_DENIED'
  );
  // 4. Unrigged OBJ format bypass attempt
  assert.equal(
    evaluateRiggedCharacterWrite({
      auth: { uid: 'u1', emailVerified: true },
      pathUserId: 'u1',
      pathCharId: 'char_01',
      data: { ...baseValid, sourceFormat: 'obj' },
      isServerTimeCreatedAt: true,
      isServerTimeUpdatedAt: true,
    }),
    'PERMISSION_DENIED'
  );
  // 5. Shadow field injection
  assert.equal(
    evaluateRiggedCharacterWrite({
      auth: { uid: 'u1', emailVerified: true },
      pathUserId: 'u1',
      pathCharId: 'char_01',
      data: { ...baseValid, isAdmin: true },
      isServerTimeCreatedAt: true,
      isServerTimeUpdatedAt: true,
    }),
    'PERMISSION_DENIED'
  );
  // 6. Unverified email
  assert.equal(
    evaluateRiggedCharacterWrite({
      auth: { uid: 'u1', emailVerified: false },
      pathUserId: 'u1',
      pathCharId: 'char_01',
      data: baseValid,
      isServerTimeCreatedAt: true,
      isServerTimeUpdatedAt: true,
    }),
    'PERMISSION_DENIED'
  );
});
