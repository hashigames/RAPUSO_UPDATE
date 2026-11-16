# RAPUSO Firestore Security Specification

## 1. Data Invariants
1. **Owner Isolation**: All character and chunk documents live under `/users/{userId}/riggedCharacters/{charId}` and can only be read, created, updated, or deleted by the authenticated verified user whose `request.auth.uid == userId` and `data.ownerUid == request.auth.uid`.
2. **Rigged-Only Character Enforcement**: Every `RiggedCharacter` document MUST enforce `hasSkinWeights == true`, `boneCount >= 1 && boneCount <= 500`, `skinnedMeshCount >= 1 && skinnedMeshCount <= 64`, and `sourceFormat in ['glb', 'gltf', 'fbx']`. Unrigged/static OBJ meshes without skeletons are rejected by both application validation and Firestore security rules.
3. **1 MiB Document Safety**: Every `RiggedCharacterChunk` document enforces `dataBase64 is string && dataBase64.size() <= 750000` and `chunkIndex >= 0 && chunkIndex < 40`, guaranteeing every document remains well below Firestore's 1 MiB hard ceiling.
4. **Master Gate Sync**: Subcollection `chunks` reads/writes validate parent `/users/{userId}/riggedCharacters/{charId}` existence and ownership via `get()`.
5. **Temporal & Key Integrity**: `createdAt == request.time` on creation, `createdAt` and `ownerUid` immutable on update, strict `keys().hasAll(...)` + `keys().hasOnly(...)` schema allowlists on create, and `affectedKeys().hasOnly(...)` on update.

## 2. Dirty Dozen Adversarial Payloads (Must Return PERMISSION_DENIED)
1. Unauthenticated read/create on `/users/u1/riggedCharacters/c1`.
2. Verified user `u2` attempting `get`/`list`/`create` under `/users/u1/riggedCharacters/...`.
3. Creating a `RiggedCharacter` with `ownerUid: "someone_else"` despite path `/users/u1/...`.
4. Creating an unrigged character (`hasSkinWeights: false` or `boneCount: 0`).
5. Creating a character with `sourceFormat: "obj"` (static unrigged mesh bypass attempt).
6. Shadow/Ghost field injection (`{ ..., isVerifiedAdmin: true }`).
7. Oversized ID poisoning (`charId` > 128 chars or containing invalid symbols like `../admin`).
8. Oversized chunk DoW (`dataBase64.size() > 750000`) or unbounded chunk index (`chunkIndex: 99`).
9. Creating a `RiggedCharacterChunk` whose parent `RiggedCharacter` does not exist or belongs to another owner.
10. Client-forged timestamps (`createdAt` != `request.time`).
11. Mutating immutable `ownerUid` or `createdAt` during `update`.
12. Unverified email account (`request.auth.token.email_verified == false`) attempting writes.
