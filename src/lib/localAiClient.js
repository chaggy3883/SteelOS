import { base44 } from '@/api/base44Client';

// Client for a private, locally-hosted OpenAI-compatible chat completion
// server (e.g. llama.cpp, vLLM, LM Studio). No commercial cloud endpoint is
// ever contacted from here — the base URL defaults to localhost and every
// call is scoped to a single tenant via buildTenantSystemPrompt below.
const DEFAULT_LOCAL_AI_URL = 'http://localhost:8080/v1';
const REQUEST_TIMEOUT_MS = 8000;

export function getLocalAiBaseUrl() {
  return import.meta.env.VITE_LOCAL_AI_URL || DEFAULT_LOCAL_AI_URL;
}

export function buildTenantSystemPrompt(companyId, companyName) {
  return [
    'You are a private, on-premise assistant for a single steel fabrication company.',
    `The active tenant is "${companyName || 'Unknown Company'}" (company_id: ${companyId || 'unknown'}).`,
    'You must restrict all reasoning and output strictly to information belonging to this tenant.',
    'Never reference, infer, or compare data from any other company, tenant, or account.',
    'If the provided context does not clearly belong to this tenant, say so instead of guessing.',
  ].join(' ');
}

// Returns the raw assistant message string, or null if the local server
// is unreachable/errored — callers are expected to fall back to a
// deterministic analyzer in that case rather than surface an error.
export async function callLocalAI(messages, { baseUrl = getLocalAiBaseUrl(), model = 'local-model', temperature = 0.2 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, temperature }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.choices?.[0]?.message?.content ?? null;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function callTenantScopedLocalAI(companyId, companyName, userPrompt, opts) {
  const messages = [
    { role: 'system', content: buildTenantSystemPrompt(companyId, companyName) },
    { role: 'user', content: userPrompt },
  ];
  return callLocalAI(messages, opts);
}

const DEFAULT_LOCAL_VLM_URL = 'http://localhost:8080/v1';
const VLM_DETECTION_INSTRUCTIONS = `You are scanning a structural steel blueprint page. Identify every steel shape annotation (columns, beams, plates) and respond with ONLY a JSON object (no prose, no markdown fences) shaped exactly as:
{"detections": [{"shape_type": string, "size_designation": string, "bbox": [x, y, width, height], "confidence": number}]}
bbox values must be fractions of the image width/height (0 to 1), measured from the top-left corner.`;

export function getLocalVlmBaseUrl() {
  return import.meta.env.VITE_LOCAL_VLM_URL || DEFAULT_LOCAL_VLM_URL;
}

// imageDataUrl is a data: or blob: URL for the blueprint page image. Returns
// a validated detections array, or null if the local VLM is unreachable or
// its reply doesn't match the expected contract.
export async function detectBlueprintShapes(companyId, companyName, imageDataUrl, scaleReference) {
  const messages = [
    { role: 'system', content: buildTenantSystemPrompt(companyId, companyName) },
    {
      role: 'user',
      content: [
        { type: 'text', text: `${VLM_DETECTION_INSTRUCTIONS}\nDrawing scale: ${scaleReference || 'unknown'}.` },
        { type: 'image_url', image_url: { url: imageDataUrl } },
      ],
    },
  ];
  const reply = await callLocalAI(messages, { baseUrl: getLocalVlmBaseUrl() });
  if (!reply) return null;
  try {
    const parsed = JSON.parse(reply);
    if (Array.isArray(parsed?.detections)) return parsed.detections;
    return null;
  } catch (e) {
    return null;
  }
}

export async function getCompanyName(companyId) {
  if (!companyId) return '';
  try {
    const company = await base44.entities.Company.get(companyId);
    return company?.name || '';
  } catch (e) {
    return '';
  }
}
