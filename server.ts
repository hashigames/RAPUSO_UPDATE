import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { sanitizeProjectManifest } from './shared/studio';
import { normalizePoseCategory } from './shared/pose-raster';
import { StudioFileStore } from './server/storage';
import {
  directMotionWithGemini,
  classifyPoseImageWithGemini,
  critiqueRasterWithGemini,
} from './server/ai';

const PORT = Number(process.env.PORT || 3000);
const MAX_POSE_UPLOAD_BYTES = 12 * 1024 * 1024; // 12 MiB per 2D pose reference image

async function startServer() {
  const app = express();
  const store = new StudioFileStore();

  app.use(express.json({ limit: '45mb' }));
  app.use(
    '/api/poses/upload-bytes',
    express.raw({ type: ['image/png', 'image/jpeg', 'image/webp', 'application/octet-stream'], limit: '15mb' })
  );

  // Health
  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      app: 'RAPUSO',
      company: 'LIGHTHOUSE 橋',
      storageProvider: 'express-local-store',
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    });
  });

  // Explicitly disconnect retired menus
  app.use(['/api/ai-video', '/api/motion-reference'], (_req, res) => {
    res.status(404).json({
      error: 'Retired workspace endpoint removed per studio scope update.',
    });
  });

  // ---- Projects ----
  app.get('/api/projects', async (_req, res) => {
    try {
      const items = await store.listProjects();
      res.json({ items });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/projects', async (req, res) => {
    try {
      const sanitized = sanitizeProjectManifest(req.body);
      const saved = await store.saveProject(sanitized);
      res.json({ project: saved });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.delete('/api/projects/:id', async (req, res) => {
    try {
      const deleted = await store.deleteProject(req.params.id);
      if (!deleted) return res.status(404).json({ error: 'Project not found.' });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ---- Characters ----
  app.get('/api/characters', async (_req, res) => {
    try {
      const items = await store.listCharacters();
      res.json({ items });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/characters', async (req, res) => {
    try {
      if (!req.body || typeof req.body.name !== 'string') {
        return res.status(400).json({ error: 'Valid character manifest is required.' });
      }
      const saved = await store.saveCharacter(req.body);
      res.json({ character: saved });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.delete('/api/characters/:id', async (req, res) => {
    try {
      const deleted = await store.deleteCharacter(req.params.id);
      if (!deleted) return res.status(404).json({ error: 'Character record not found.' });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ---- Persisted Rigged Characters (Direct Save Forever without sign-in) ----
  app.get('/api/rigged-characters', async (_req, res) => {
    try {
      const items = await store.listRiggedCharacters();
      res.json({ items });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/rigged-characters', async (req, res) => {
    try {
      const body = req.body || {};
      if (typeof body.dataBase64 !== 'string' || !body.dataBase64) {
        return res.status(400).json({ error: 'Character GLB payload is required.' });
      }
      const glbBytes = Buffer.from(body.dataBase64, 'base64');
      const saved = await store.saveRiggedCharacter({
        id: typeof body.id === 'string' ? body.id : undefined,
        name: typeof body.name === 'string' ? body.name : 'Rigged Character',
        sourceFormat: String(body.sourceFormat || 'glb'),
        primaryFileName: typeof body.primaryFileName === 'string' ? body.primaryFileName : 'character.glb',
        boneCount: Number(body.boneCount || 0),
        skinnedMeshCount: Number(body.skinnedMeshCount || 0),
        hasSkinWeights: Boolean(body.hasSkinWeights),
        textureCount: Number(body.textureCount || 0),
        glbBytes,
      });
      res.json({ item: saved });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.get('/api/rigged-characters/:id/glb', async (req, res) => {
    try {
      const found = await store.readRiggedCharacterBytes(req.params.id);
      if (!found) return res.status(404).json({ error: 'Saved rigged character not found.' });
      res.setHeader('Content-Type', 'model/gltf-binary');
      res.send(found.bytes);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.delete('/api/rigged-characters/:id', async (req, res) => {
    try {
      const deleted = await store.deleteRiggedCharacter(req.params.id);
      if (!deleted) return res.status(404).json({ error: 'Saved rigged character not found.' });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ---- 2D Poses Library ----
  app.get('/api/poses', async (req, res) => {
    try {
      const search = typeof req.query.search === 'string' ? req.query.search : '';
      const catRaw = typeof req.query.category === 'string' ? req.query.category : 'all';
      const category = catRaw === 'all' ? 'all' : normalizePoseCategory(catRaw);
      const page = Number(req.query.page || 1);
      const pageSize = Number(req.query.pageSize || 12);
      const result = await store.listPoses({ search, category, page, pageSize });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/poses/reserve', async (req, res) => {
    try {
      const { reservationId, name, mimeType, sizeBytes } = req.body || {};
      if (typeof mimeType !== 'string' || !/^image\/(png|jpeg|webp)$/i.test(mimeType)) {
        return res.status(400).json({ error: 'Only PNG, JPEG, or WebP images are supported.' });
      }
      if (typeof sizeBytes !== 'number' || sizeBytes <= 0 || sizeBytes > MAX_POSE_UPLOAD_BYTES) {
        return res.status(400).json({ error: 'Image size must be between 1 B and 12 MiB.' });
      }
      const reserved = await store.reservePoseUpload({
        reservationId: typeof reservationId === 'string' ? reservationId : undefined,
        name: typeof name === 'string' ? name : 'Untitled Pose',
        mimeType,
        sizeBytes,
      });
      res.json({ reservation: reserved });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.put('/api/poses/upload-bytes/:id', async (req, res) => {
    try {
      const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
      if (buf.byteLength === 0 || buf.byteLength > MAX_POSE_UPLOAD_BYTES) {
        return res.status(400).json({ error: 'Invalid uploaded image byte length.' });
      }
      const mimeHeader = String(req.headers['content-type'] || 'image/png');
      const autoClassify = req.query.autoClassify !== 'false';
      let category: 'girl' | 'boy' | 'unsorted' = 'unsorted';
      let note = 'Manual upload (Uncategorized).';

      if (autoClassify) {
        const visionRes = await classifyPoseImageWithGemini({
          base64Data: buf.toString('base64'),
          mimeType: mimeHeader.split(';')[0],
        });
        category = visionRes.category;
        note = visionRes.note;
      }

      const committed = await store.commitPoseBytes({
        id: req.params.id,
        bytes: buf,
        category,
        aiSuggestedCategory: category,
        aiConfidenceNote: note,
      });
      if (!committed) return res.status(404).json({ error: 'Reservation ID not found.' });
      res.json({ pose: committed });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/poses/objects/:objectKey', async (req, res) => {
    try {
      const obj = await store.readPoseObjectBytes(req.params.objectKey);
      if (!obj) return res.status(404).send('Not found');
      res.setHeader('Content-Type', obj.mimeType);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.send(obj.bytes);
    } catch {
      res.status(500).send('Error reading pose image');
    }
  });

  app.post('/api/poses/:id/reclassify', async (req, res) => {
    try {
      const list = await store.listPoses({ page: 1, pageSize: 100 });
      const target = list.items.find((p) => p.id === req.params.id);
      if (!target) return res.status(404).json({ error: 'Pose not found.' });
      const obj = await store.readPoseObjectBytes(target.objectKey);
      if (!obj) return res.status(404).json({ error: 'Pose image bytes missing.' });

      const visionRes = await classifyPoseImageWithGemini({
        base64Data: obj.bytes.toString('base64'),
        mimeType: obj.mimeType,
      });
      const updated = await store.updatePoseMetadata(req.params.id, {
        category: visionRes.category,
        aiSuggestedCategory: visionRes.category,
        aiConfidenceNote: visionRes.note,
      });
      res.json({ pose: updated });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.patch('/api/poses/:id', async (req, res) => {
    try {
      const updated = await store.updatePoseMetadata(req.params.id, {
        name: typeof req.body?.name === 'string' ? req.body.name : undefined,
        category: typeof req.body?.category === 'string' ? normalizePoseCategory(req.body.category) : undefined,
      });
      if (!updated) return res.status(404).json({ error: 'Pose not found.' });
      res.json({ pose: updated });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.delete('/api/poses/:id', async (req, res) => {
    try {
      const deleted = await store.deletePose(req.params.id);
      if (!deleted) return res.status(404).json({ error: 'Pose not found.' });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ---- AI Motion Direction ----
  app.post('/api/ai/direct-motion', async (req, res) => {
    try {
      const { prompt, language, availableClipNames, hasSkinWeights } = req.body || {};
      if (typeof prompt !== 'string' || !prompt.trim()) {
        return res.status(400).json({ error: 'Prompt text is required.' });
      }
      const result = await directMotionWithGemini({
        prompt: prompt.trim(),
        language: language === 'ja' ? 'ja' : 'en',
        availableClipNames: Array.isArray(availableClipNames) ? availableClipNames.map(String) : [],
        hasSkinWeights: Boolean(hasSkinWeights),
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ---- AI Anime/Manga Art Director Critique (free-tier gemini-4-hydrogen) ----
  app.post('/api/ai/critique-raster', async (req, res) => {
    try {
      const { imageDataUrl, language, currentPreset } = req.body || {};
      if (typeof imageDataUrl !== 'string' || !imageDataUrl.includes(',')) {
        return res.status(400).json({ error: 'Valid raster image data URL is required.' });
      }
      const [header, base64Data] = imageDataUrl.split(',', 2);
      const mimeMatch = header.match(/data:([^;]+);base64/i);
      const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
      const result = await critiqueRasterWithGemini({
        base64Data,
        mimeType,
        language: language === 'ja' ? 'ja' : 'en',
        currentPreset: currentPreset || 'anime_tv',
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Vite middleware in dev, static dist in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`RAPUSO (らぷそ) studio listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start RAPUSO studio server:', err);
  process.exit(1);
});
