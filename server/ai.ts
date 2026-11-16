import { GoogleGenAI, Type } from '@google/genai';
import { clampTimelineDuration, type LanguageCode } from '../shared/studio';
import {
  normalizePoseCategory,
  type AnimeShaderPreset,
  type AnimeShadowTint,
  type BackgroundHarmonyMode,
  type InkPenStyle,
  type PoseCategory,
} from '../shared/pose-raster';

export interface MotionDirectionStep {
  sourceClipName: string;
  label: string;
  durationSec: number;
  speed: number;
  loop: boolean;
}

export interface MotionDirectionResult {
  supported: boolean;
  sequence: MotionDirectionStep[];
  explanation: string;
  missingRequirements: string[];
  modelUsed: string;
}

function createGeminiClient(): GoogleGenAI | null {
  const key = process.env.GEMINI_API_KEY;
  if (!key || !key.trim()) return null;
  return new GoogleGenAI({
    apiKey: key,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export function validateDirectedSequence(
  rawSequence: Array<Partial<MotionDirectionStep>>,
  availableClipNames: string[]
): MotionDirectionStep[] {
  const allowed = new Set(availableClipNames);
  const valid: MotionDirectionStep[] = [];
  for (const item of rawSequence) {
    if (!item || typeof item.sourceClipName !== 'string' || !allowed.has(item.sourceClipName)) {
      continue;
    }
    valid.push({
      sourceClipName: item.sourceClipName,
      label: typeof item.label === 'string' && item.label.trim() ? item.label.trim() : item.sourceClipName,
      durationSec: clampTimelineDuration(typeof item.durationSec === 'number' ? item.durationSec : 3),
      speed:
        typeof item.speed === 'number' && Number.isFinite(item.speed)
          ? Math.min(3, Math.max(0.25, item.speed))
          : 1,
      loop: typeof item.loop === 'boolean' ? item.loop : true,
    });
  }
  return valid;
}

export async function directMotionWithGemini(params: {
  prompt: string;
  language: LanguageCode;
  availableClipNames: string[];
  hasSkinWeights: boolean;
}): Promise<MotionDirectionResult> {
  if (!params.hasSkinWeights) {
    return {
      supported: false,
      sequence: [],
      explanation:
        params.language === 'ja'
          ? '現在のメッシュにはスキンウェイトがありません。アニメーションさせるにはスキニング済みキャラクターが必要です。'
          : 'This mesh has no skin weights; upload a skinned character to direct skeletal motion.',
      missingRequirements: ['Skinned character mesh'],
      modelUsed: 'validation-guard',
    };
  }

  if (params.availableClipNames.length === 0) {
    return {
      supported: false,
      sequence: [],
      explanation:
        params.language === 'ja'
          ? '利用可能なモーションクリップがありません。クリップを読み込むか「ポーズキーフレームのみ」モードをご利用ください。'
          : 'This action needs an animation clip. Upload FBX/GLB motion clips or switch to Pose keyframes only mode.',
      missingRequirements: ['At least one compatible animation clip'],
      modelUsed: 'validation-guard',
    };
  }

  const ai = createGeminiClient();
  if (!ai) {
    // Deterministic fallback matching only existing clip names when GEMINI_API_KEY is absent
    const lower = params.prompt.toLowerCase();
    const matched = params.availableClipNames.filter((name) => {
      const tokens = name.toLowerCase().split(/\s+/);
      return tokens.some((t) => t.length > 2 && lower.includes(t));
    });
    const chosen = matched.length > 0 ? matched : [params.availableClipNames[0]];
    return {
      supported: matched.length > 0,
      sequence: chosen.map((name) => ({
        sourceClipName: name,
        label: name,
        durationSec: 4,
        speed: 1,
        loop: true,
      })),
      explanation:
        matched.length > 0
          ? 'Matched prompt keywords against currently loaded clips (GEMINI_API_KEY not configured).'
          : 'No exact clip keyword matched and GEMINI_API_KEY is not configured; previewing first loaded clip instead of inventing motion.',
      missingRequirements: matched.length > 0 ? [] : ['GEMINI_API_KEY for natural-language planning'],
      modelUsed: 'deterministic-allowlist',
    };
  }

  const sysPrompt =
    `You are the RAPUSO studio motion planner. Translate the user's English or Japanese prompt ONLY into sequences referencing the exact availableClips list: ${JSON.stringify(
      params.availableClipNames
    )}. Never invent clip names. If the user asks for physics, cloth tearing, camera cuts outside clip sequencing, or unavailable actions, set supported=false and explain honestly in ${
      params.language === 'ja' ? 'Japanese' : 'English'
    }.`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Prompt: ${params.prompt}\nAvailable clips: ${params.availableClipNames.join(', ')}`,
      config: {
        systemInstruction: sysPrompt,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            supported: { type: Type.BOOLEAN },
            explanation: { type: Type.STRING },
            missingRequirements: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            sequence: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  sourceClipName: { type: Type.STRING },
                  label: { type: Type.STRING },
                  durationSec: { type: Type.NUMBER },
                  speed: { type: Type.NUMBER },
                  loop: { type: Type.BOOLEAN },
                },
              },
            },
          },
        },
      },
    });

    const parsed = JSON.parse((response.text ?? '{}').trim()) as {
      supported?: boolean;
      explanation?: string;
      missingRequirements?: string[];
      sequence?: Array<Partial<MotionDirectionStep>>;
    };

    const validatedSeq = validateDirectedSequence(
      Array.isArray(parsed.sequence) ? parsed.sequence : [],
      params.availableClipNames
    );

    return {
      supported: Boolean(parsed.supported) && validatedSeq.length > 0,
      sequence: validatedSeq,
      explanation:
        typeof parsed.explanation === 'string' && parsed.explanation.trim()
          ? parsed.explanation
          : 'Sequence validated against currently loaded clips.',
      missingRequirements: Array.isArray(parsed.missingRequirements)
        ? parsed.missingRequirements.map(String)
        : [],
      modelUsed: 'gemini-4-hydrogen',
    };
  } catch (err) {
    return {
      supported: false,
      sequence: [],
      explanation: `Gemini motion planning error: ${(err as Error).message}`,
      missingRequirements: ['Valid Gemini API response'],
      modelUsed: 'gemini-4-hydrogen',
    };
  }
}

export async function classifyPoseImageWithGemini(params: {
  base64Data: string;
  mimeType: string;
}): Promise<{ category: PoseCategory; note: string }> {
  const ai = createGeminiClient();
  if (!ai) {
    return {
      category: 'unsorted',
      note: 'Saved as Unsorted (GEMINI_API_KEY unavailable; edit category manually).',
    };
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: params.mimeType,
              data: params.base64Data,
            },
          },
          {
            text: 'Classify this 2D pose reference image strictly for drawing-folder organization. Return "girl" ONLY if it is clearly a single fictional drawn female character, "boy" ONLY if it is clearly a single fictional drawn male character, and "unsorted" for real-person photographs, multi-person drawings, robots/non-human subjects, or ambiguous sketches. Category labels are organizational suggestions only.',
          },
        ],
      },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            category: { type: Type.STRING },
            reason: { type: Type.STRING },
          },
        },
      },
    });

    const parsed = JSON.parse((response.text ?? '{}').trim()) as {
      category?: string;
      reason?: string;
    };
    const cat = normalizePoseCategory(parsed.category);
    return {
      category: cat,
      note:
        typeof parsed.reason === 'string' && parsed.reason.trim()
          ? `Gemini suggestion (${cat}): ${parsed.reason.trim()}`
          : `Gemini organizational suggestion: ${cat}`,
    };
  } catch (err) {
    return {
      category: 'unsorted',
      note: `Vision suggestion unavailable (${(err as Error).message}); image saved safely as Unsorted.`,
    };
  }
}

export interface RasterCritiqueResult {
  critique: string;
  suggestedPreset: AnimeShaderPreset;
  suggestedPenStyle: InkPenStyle;
  suggestedShadowTint: AnimeShadowTint;
  suggestedBackgroundHarmony: BackgroundHarmonyMode;
  suggestedLineWidth: number;
  suggestedEdgeThreshold: number;
  suggestedRimGlow: number;
  modelUsed: string;
}

export async function critiqueRasterWithGemini(params: {
  base64Data: string;
  mimeType: string;
  language: LanguageCode;
  currentPreset: AnimeShaderPreset;
}): Promise<RasterCritiqueResult> {
  const ai = createGeminiClient();
  const fallback: RasterCritiqueResult = {
    critique:
      params.language === 'ja'
        ? '日本のアニメ・漫画市場向けに、3Dトゥーンシェーダー＋Gペン輪郭＋クール系バイオレット影＋2倍スーパーサンプリング＋背景アニメ調和をおすすめします。'
        : 'For Japanese anime/manga finish, enable 3D Toon Shader + G-Pen ink + Cool Violet shadows + 2x Supersampling + Anime Paint background harmony to smooth hair/skin edges and blend the backdrop.',
    suggestedPreset: 'anime_tv',
    suggestedPenStyle: 'g_pen',
    suggestedShadowTint: 'cool_violet',
    suggestedBackgroundHarmony: 'anime_paint',
    suggestedLineWidth: 2,
    suggestedEdgeThreshold: 0.34,
    suggestedRimGlow: 0.58,
    modelUsed: ai ? 'gemini-4-hydrogen' : 'deterministic-art-director',
  };

  if (!ai) return fallback;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: params.mimeType,
              data: params.base64Data,
            },
          },
          {
            text: `You are a veteran Japanese anime & manga art director reviewing a 3D-to-2D rasterized frame (current preset: ${params.currentPreset}). Critique linework sharpness, shadow banding, hair/skin clarity, camera framing, and background integration in ${
              params.language === 'ja' ? 'Japanese' : 'English'
            } (2-3 concise sentences), and recommend exact shader settings: suggestedPreset (one of anime_tv, shonen_manga, shojo_pastel, seinen_gekiga, anime_film), suggestedPenStyle (g_pen, maru_pen, fude_brush), suggestedShadowTint (cool_violet, warm_sepia, neutral_ink), suggestedBackgroundHarmony (anime_paint, manga_tone, raw_photo), suggestedLineWidth (integer 1-4), suggestedEdgeThreshold (0.25-0.55), suggestedRimGlow (0.2-0.85).`,
          },
        ],
      },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            critique: { type: Type.STRING },
            suggestedPreset: { type: Type.STRING },
            suggestedPenStyle: { type: Type.STRING },
            suggestedShadowTint: { type: Type.STRING },
            suggestedBackgroundHarmony: { type: Type.STRING },
            suggestedLineWidth: { type: Type.NUMBER },
            suggestedEdgeThreshold: { type: Type.NUMBER },
            suggestedRimGlow: { type: Type.NUMBER },
          },
        },
      },
    });

    const parsed = JSON.parse((response.text ?? '{}').trim()) as Partial<RasterCritiqueResult>;
    const validPresets = new Set<AnimeShaderPreset>([
      'anime_tv',
      'shonen_manga',
      'shojo_pastel',
      'seinen_gekiga',
      'anime_film',
    ]);
    const validPens = new Set<InkPenStyle>(['g_pen', 'maru_pen', 'fude_brush']);
    const validTints = new Set<AnimeShadowTint>(['cool_violet', 'warm_sepia', 'neutral_ink']);
    const validBg = new Set<BackgroundHarmonyMode>(['anime_paint', 'manga_tone', 'raw_photo']);

    return {
      critique:
        typeof parsed.critique === 'string' && parsed.critique.trim()
          ? parsed.critique.trim()
          : fallback.critique,
      suggestedPreset: validPresets.has(parsed.suggestedPreset as AnimeShaderPreset)
        ? (parsed.suggestedPreset as AnimeShaderPreset)
        : fallback.suggestedPreset,
      suggestedPenStyle: validPens.has(parsed.suggestedPenStyle as InkPenStyle)
        ? (parsed.suggestedPenStyle as InkPenStyle)
        : fallback.suggestedPenStyle,
      suggestedShadowTint: validTints.has(parsed.suggestedShadowTint as AnimeShadowTint)
        ? (parsed.suggestedShadowTint as AnimeShadowTint)
        : fallback.suggestedShadowTint,
      suggestedBackgroundHarmony: validBg.has(parsed.suggestedBackgroundHarmony as BackgroundHarmonyMode)
        ? (parsed.suggestedBackgroundHarmony as BackgroundHarmonyMode)
        : fallback.suggestedBackgroundHarmony,
      suggestedLineWidth:
        typeof parsed.suggestedLineWidth === 'number' && Number.isFinite(parsed.suggestedLineWidth)
          ? Math.max(1, Math.min(4, Math.round(parsed.suggestedLineWidth)))
          : fallback.suggestedLineWidth,
      suggestedEdgeThreshold:
        typeof parsed.suggestedEdgeThreshold === 'number' && Number.isFinite(parsed.suggestedEdgeThreshold)
          ? Math.max(0.2, Math.min(0.6, Number(parsed.suggestedEdgeThreshold.toFixed(2))))
          : fallback.suggestedEdgeThreshold,
      suggestedRimGlow:
        typeof parsed.suggestedRimGlow === 'number' && Number.isFinite(parsed.suggestedRimGlow)
          ? Math.max(0.1, Math.min(0.9, Number(parsed.suggestedRimGlow.toFixed(2))))
          : fallback.suggestedRimGlow,
      modelUsed: 'gemini-4-hydrogen',
    };
  } catch (err) {
    return {
      ...fallback,
      critique: `${fallback.critique} (${(err as Error).message})`,
    };
  }
}

