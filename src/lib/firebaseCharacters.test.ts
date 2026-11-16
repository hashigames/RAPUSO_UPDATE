import test from 'node:test';
import assert from 'node:assert/strict';
import type { RigDiagnostics } from '../../shared/characters';
import {
  reassembleBase64ChunksToBytes,
  sliceBytesToBase64Chunks,
  validateRiggedCharacterOnly,
} from './firebaseCharacterUtils';
import { autoClassifyTextureFolderFiles, normalizeResourcePath } from './animation/loaders';

const riggedDiag: RigDiagnostics = {
  meshCount: 1,
  skinnedMeshCount: 1,
  boneCount: 24,
  vertexCount: 1200,
  triangleCount: 2400,
  materialSlotNames: ['BodyMat'],
  boneNames: ['Hips', 'Spine', 'Head'],
  embeddedClipCount: 1,
  morphTargetNames: [],
  hasSkinWeights: true,
  hasArticulatedFingers: false,
  warnings: [],
};

const unriggedDiag: RigDiagnostics = {
  ...riggedDiag,
  skinnedMeshCount: 0,
  boneCount: 0,
  boneNames: [],
  hasSkinWeights: false,
};

test('validateRiggedCharacterOnly rejects OBJ and unrigged meshes, accepts rigged GLB/FBX', () => {
  const objCheck = validateRiggedCharacterOnly(unriggedDiag, 'obj');
  assert.equal(objCheck.valid, false);
  assert.ok((objCheck as { valid: false; reason: string }).reason.includes('Only rigged characters'));

  const staticFbxCheck = validateRiggedCharacterOnly(unriggedDiag, 'fbx');
  assert.equal(staticFbxCheck.valid, false);

  const riggedGlbCheck = validateRiggedCharacterOnly(riggedDiag, 'glb');
  assert.equal(riggedGlbCheck.valid, true);

  const riggedFbxCheck = validateRiggedCharacterOnly(riggedDiag, 'fbx');
  assert.equal(riggedFbxCheck.valid, true);
});

test('sliceBytesToBase64Chunks and reassembleBase64ChunksToBytes round-trip accurately across chunks', () => {
  const payload = new Uint8Array(1500);
  for (let i = 0; i < payload.length; i++) {
    payload[i] = (i * 31 + 7) & 0xff;
  }

  const chunks = sliceBytesToBase64Chunks(payload, 400);
  assert.equal(chunks.length, 4);

  // Shuffle order before reassembly to confirm chunkIndex ordering works
  const shuffled = chunks
    .map((dataBase64, chunkIndex) => ({ chunkIndex, dataBase64 }))
    .reverse();

  const restored = reassembleBase64ChunksToBytes(shuffled);
  assert.deepEqual(restored, payload);

  assert.throws(() => sliceBytesToBase64Chunks(new Uint8Array(0)), /empty/i);
});

test('autoClassifyTextureFolderFiles classifies textures/mats folder files and normalizes paths', () => {
  assert.equal(normalizeResourcePath('./MyChar\\textures\\Body_Normal.PNG?v=1'), 'mychar/textures/body_normal.png');

  const res = autoClassifyTextureFolderFiles([
    { name: 'Hero_Albedo.png', webkitRelativePath: 'Character/textures/Hero_Albedo.png' },
    { name: 'Hero_Normal.png', webkitRelativePath: 'Character/textures/Hero_Normal.png' },
    { name: 'Hero_Roughness.jpg', webkitRelativePath: 'Character/textures/Hero_Roughness.jpg' },
    { name: 'Hero_Metallic.png', webkitRelativePath: 'Character/textures/Hero_Metallic.png' },
    { name: 'Hero.mtl', webkitRelativePath: 'Character/mats/Hero.mtl' },
    { name: 'scene.bin', webkitRelativePath: 'Character/scene.bin' },
  ]);

  assert.equal(res.imageFiles.length, 4);
  assert.equal(res.imageFiles[0].channel, 'baseColor');
  assert.equal(res.imageFiles[1].channel, 'normal');
  assert.equal(res.imageFiles[2].channel, 'roughness');
  assert.equal(res.imageFiles[3].channel, 'metallic');
  assert.deepEqual(res.materialCompanionFiles, ['Hero.mtl', 'scene.bin']);
});
