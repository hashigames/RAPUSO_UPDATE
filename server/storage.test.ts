import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { StudioFileStore } from './storage';
import { validateDirectedSequence } from './ai';

test('StudioFileStore handles reservation-first pose upload, A->B->A filtering, rename, and deletion', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rapuso-store-'));
  try {
    const store = new StudioFileStore(tmpDir);

    // Reserve pending pose
    const res1 = await store.reservePoseUpload({
      name: 'Heroic Jump',
      mimeType: 'image/png',
      sizeBytes: 128,
    });
    // Pending must stay hidden until bytes committed
    let list = await store.listPoses({ category: 'all' });
    assert.equal(list.total, 0);

    // Idempotent retry on same reservationId
    const res1Retry = await store.reservePoseUpload({
      reservationId: res1.id,
      name: 'Heroic Jump',
      mimeType: 'image/png',
      sizeBytes: 128,
    });
    assert.equal(res1Retry.objectKey, res1.objectKey);

    // Commit bytes
    const committed = await store.commitPoseBytes({
      id: res1.id,
      bytes: Buffer.from([137, 80, 78, 71]),
      category: 'girl',
      aiSuggestedCategory: 'girl',
      aiConfidenceNote: 'Fictional illustration',
    });
    assert.ok(committed);
    assert.equal(committed.category, 'girl');

    // Add second unsorted pose
    const res2 = await store.reservePoseUpload({
      name: 'Standing Neutral',
      mimeType: 'image/png',
      sizeBytes: 64,
    });
    await store.commitPoseBytes({
      id: res2.id,
      bytes: Buffer.from([1, 2, 3, 4]),
      category: 'boy',
    });

    // Category filter A -> B -> A pagination test
    const girlList = await store.listPoses({ category: 'girl' });
    assert.equal(girlList.total, 1);
    assert.equal(girlList.items[0].name, 'Heroic Jump');

    const boyList = await store.listPoses({ category: 'boy' });
    assert.equal(boyList.total, 1);
    assert.equal(boyList.items[0].name, 'Standing Neutral');

    const allList = await store.listPoses({ category: 'all' });
    assert.equal(allList.total, 2);

    // Rename & delete
    const renamed = await store.updatePoseMetadata(res1.id, { name: 'Midair Action' });
    assert.equal(renamed?.name, 'Midair Action');

    const deleted = await store.deletePose(res1.id);
    assert.equal(deleted, true);
    const afterDelete = await store.listPoses({ category: 'all' });
    assert.equal(afterDelete.total, 1);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('validateDirectedSequence strictly allowlists loaded clips and clamps durations', () => {
  const out = validateDirectedSequence(
    [
      { sourceClipName: 'Studio Walk', durationSec: 4, speed: 1.2 },
      { sourceClipName: 'Invented Backflip', durationSec: 5 },
      { sourceClipName: 'Idle Breath', durationSec: 9999 },
    ],
    ['Idle Breath', 'Studio Walk']
  );
  assert.equal(out.length, 2);
  assert.equal(out[0].sourceClipName, 'Studio Walk');
  assert.equal(out[1].durationSec, 600);
});

test('StudioFileStore persists rigged GLB characters, enforces rigged-only, and deletes cleanly', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rapuso-rigged-'));
  try {
    const store = new StudioFileStore(tmpDir);

    await assert.rejects(
      () =>
        store.saveRiggedCharacter({
          name: 'Static Box',
          sourceFormat: 'obj',
          primaryFileName: 'box.obj',
          boneCount: 0,
          skinnedMeshCount: 0,
          hasSkinWeights: false,
          textureCount: 0,
          glbBytes: Buffer.from([1, 2, 3]),
        }),
      /rigged/i
    );

    const saved = await store.saveRiggedCharacter({
      name: 'Sakura Hero',
      sourceFormat: 'fbx',
      primaryFileName: 'sakura.fbx',
      boneCount: 42,
      skinnedMeshCount: 2,
      hasSkinWeights: true,
      textureCount: 4,
      glbBytes: Buffer.from([103, 108, 84, 70, 2, 0, 0, 0]),
    });

    const list = await store.listRiggedCharacters();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, saved.id);
    assert.equal(list[0].boneCount, 42);

    const loaded = await store.readRiggedCharacterBytes(saved.id);
    assert.ok(loaded);
    assert.equal(loaded.bytes.byteLength, 8);
    assert.equal(loaded.meta.name, 'Sakura Hero');

    const deleted = await store.deleteRiggedCharacter(saved.id);
    assert.equal(deleted, true);
    assert.equal((await store.listRiggedCharacters()).length, 0);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
