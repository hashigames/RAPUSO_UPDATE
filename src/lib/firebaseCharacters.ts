import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import type { PortableCharacterManifest } from '../../shared/characters';
import { db, handleFirestoreError, OperationType } from './firebase';
import {
  FIRESTORE_MAX_CHUNK_COUNT,
  FIRESTORE_MAX_RAW_CHUNK_BYTES,
  reassembleBase64ChunksToBytes,
  sanitizeFirestoreId,
  sliceBytesToBase64Chunks,
  validateRiggedCharacterOnly,
} from './firebaseCharacterUtils';

export {
  FIRESTORE_MAX_CHUNK_COUNT,
  FIRESTORE_MAX_RAW_CHUNK_BYTES,
  reassembleBase64ChunksToBytes,
  sanitizeFirestoreId,
  sliceBytesToBase64Chunks,
  validateRiggedCharacterOnly,
};

export interface FirebaseRiggedCharacterDoc {
  id: string;
  ownerUid: string;
  name: string;
  sourceFormat: 'glb' | 'gltf' | 'fbx';
  primaryFileName: string;
  boneCount: number;
  skinnedMeshCount: number;
  hasSkinWeights: boolean;
  textureCount: number;
  chunkCount: number;
  totalBytes: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export async function ensureUserProfileDoc(user: User): Promise<void> {
  const userPath = `users/${user.uid}`;
  const ref = doc(db, 'users', user.uid);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        uid: user.uid,
        displayName: (user.displayName || user.email || 'RAPUSO Artist').slice(0, 120),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, userPath);
  }
}

export async function saveRiggedCharacterForever(params: {
  user: User;
  manifest: PortableCharacterManifest;
  glbBytes: Uint8Array;
  onProgress?: (pct: number) => void;
}): Promise<FirebaseRiggedCharacterDoc> {
  const { user, manifest, glbBytes, onProgress } = params;
  const check = validateRiggedCharacterOnly(manifest.diagnostics, manifest.format);
  if (!check.valid) {
    throw new Error((check as { valid: false; reason: string }).reason);
  }

  await ensureUserProfileDoc(user);
  const charId = sanitizeFirestoreId(
    manifest.savedRecordId || `char_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  );
  const safeFormat: 'glb' | 'gltf' | 'fbx' =
    manifest.format === 'fbx' ? 'fbx' : manifest.format === 'gltf' ? 'gltf' : 'glb';

  const base64Chunks = sliceBytesToBase64Chunks(glbBytes);
  const charPath = `users/${user.uid}/riggedCharacters/${charId}`;
  const charRef = doc(db, 'users', user.uid, 'riggedCharacters', charId);

  const payload: FirebaseRiggedCharacterDoc = {
    id: charId,
    ownerUid: user.uid,
    name: manifest.name.trim().slice(0, 120) || 'Rigged Character',
    sourceFormat: safeFormat,
    primaryFileName: manifest.primaryFileName.slice(0, 180) || 'character.glb',
    boneCount: Math.max(1, Math.min(500, manifest.diagnostics.boneCount)),
    skinnedMeshCount: Math.max(1, Math.min(64, manifest.diagnostics.skinnedMeshCount)),
    hasSkinWeights: true,
    textureCount: Math.max(0, Math.min(64, manifest.textureBindings.length + manifest.companionFiles.length)),
    chunkCount: base64Chunks.length,
    totalBytes: glbBytes.byteLength,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  onProgress?.(5);
  try {
    // Delete old chunks if overwriting an existing record
    const existingSnap = await getDoc(charRef);
    if (existingSnap.exists()) {
      const oldChunksSnap = await getDocs(collection(db, `${charPath}/chunks`));
      if (!oldChunksSnap.empty) {
        const delBatch = writeBatch(db);
        oldChunksSnap.docs.forEach((d) => delBatch.delete(d.ref));
        await delBatch.commit();
      }
      await setDoc(charRef, {
        ...payload,
        createdAt: existingSnap.data().createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(charRef, payload);
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, charPath);
  }

  // Write chunks sequentially in small batches (5 docs/batch)
  for (let i = 0; i < base64Chunks.length; i += 5) {
    const batch = writeBatch(db);
    const slice = base64Chunks.slice(i, i + 5);
    slice.forEach((dataBase64, offset) => {
      const chunkIndex = i + offset;
      const chunkRef = doc(db, 'users', user.uid, 'riggedCharacters', charId, 'chunks', `c_${chunkIndex}`);
      batch.set(chunkRef, {
        charId,
        ownerUid: user.uid,
        chunkIndex,
        dataBase64,
        createdAt: serverTimestamp(),
      });
    });
    try {
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `${charPath}/chunks`);
    }
    onProgress?.(Math.min(100, Math.round(((i + slice.length) / base64Chunks.length) * 95) + 5));
  }

  return payload;
}

export function subscribeUserRiggedCharacters(
  uid: string,
  onList: (items: FirebaseRiggedCharacterDoc[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = `users/${uid}/riggedCharacters`;
  const q = query(collection(db, 'users', uid, 'riggedCharacters'), orderBy('updatedAt', 'desc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const docs = snapshot.docs.map((d) => d.data() as FirebaseRiggedCharacterDoc);
      onList(docs);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError?.(wrapped as Error);
      }
    }
  );
}

export async function loadRiggedCharacterGlbFromFirebase(
  uid: string,
  charId: string
): Promise<{ bytes: Uint8Array; fileName: string; metadata: FirebaseRiggedCharacterDoc }> {
  const charPath = `users/${uid}/riggedCharacters/${charId}`;
  try {
    const metaSnap = await getDoc(doc(db, 'users', uid, 'riggedCharacters', charId));
    if (!metaSnap.exists()) {
      throw new Error('Saved Firebase character document not found.');
    }
    const metadata = metaSnap.data() as FirebaseRiggedCharacterDoc;
    const chunksSnap = await getDocs(collection(db, 'users', uid, 'riggedCharacters', charId, 'chunks'));
    const rawChunks = chunksSnap.docs.map((d) => d.data() as { chunkIndex: number; dataBase64: string });
    const bytes = reassembleBase64ChunksToBytes(rawChunks);
    const glbName = metadata.primaryFileName.replace(/\.(fbx|gltf)$/i, '') + '.glb';
    return { bytes, fileName: glbName, metadata };
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, charPath);
  }
}

export async function deleteRiggedCharacterFromFirebase(uid: string, charId: string): Promise<void> {
  const charPath = `users/${uid}/riggedCharacters/${charId}`;
  try {
    const chunksSnap = await getDocs(collection(db, 'users', uid, 'riggedCharacters', charId, 'chunks'));
    for (let i = 0; i < chunksSnap.docs.length; i += 20) {
      const batch = writeBatch(db);
      chunksSnap.docs.slice(i, i + 20).forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
    await deleteDoc(doc(db, 'users', uid, 'riggedCharacters', charId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, charPath);
  }
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
