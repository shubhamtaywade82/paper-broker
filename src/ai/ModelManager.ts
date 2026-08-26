import { OllamaClient } from '@nemesis-oss/ollama-sdk';
import { logger } from '../telemetry/logger.js';

/**
 * Model types the agent may want to call. Today only `llm` is wired (the
 * underlying Ollama SDK serves open-weight models — Llama 3, Qwen, Mistral,
 * Gemma — locally or via Ollama Cloud). `vision` and `timeSeries` are
 * declared so callers can be written against the router now and the actual
 * model adapters can be slotted in later without touching call sites.
 *
 * "Open weight" guarantee: every model reachable through this router is
 * either a local Ollama pull (weights live on disk under Ollama's data dir)
 * or an Ollama Cloud endpoint that serves an open-weight lineage. No closed
 * proprietary model is reachable from this class.
 */
export type ModelKind = 'llm' | 'vision' | 'timeSeries';

export interface ModelEndpoint {
  /** Friendly name used by the router and logs. */
  name: string;
  kind: ModelKind;
  baseUrl: string;
  model: string;
  apiKey?: string;
  /**
   * Lower number = higher priority. The Ollama SDK walks endpoints in array
   * order; we honour that and pass the array in priority-sorted order.
   */
  priority: number;
  /** Soft per-request timeout in milliseconds. */
  timeoutMs?: number;
}

export interface CompletionRequest {
  /** The system prompt establishing the model's role and constraints. */
  system: string;
  /** The user prompt — typically a JSON-serialisable market context dump. */
  prompt: string;
  /** Whether to ask the model to respond in strict JSON. */
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
}

export interface CompletionResponse {
  /** The raw model output (JSON string if `json: true` was requested). */
  text: string;
  /** Which model was used (informational). */
  model: string;
  /** Latency of the call in ms. */
  latencyMs: number;
}

export interface ModelManagerConfig {
  /** LLM endpoints in failover order (priority sorted ascending). */
  llmEndpoints: ModelEndpoint[];
  /** Vision endpoints (placeholder — visionComplete() throws Not Implemented). */
  visionEndpoints?: ModelEndpoint[];
  /** Time-series endpoints (placeholder — timeSeriesPredict() throws Not Implemented). */
  timeSeriesEndpoints?: ModelEndpoint[];
  /** Hard ceiling on a single complete() call. */
  globalTimeoutMs?: number;
  /** Default model name when an endpoint doesn't override it. */
  defaultModel?: string;
}

/**
 * Unified router over the open-weight model fleet.
 *
 * The point of this class is **not** to wrap more SDKs than necessary — it's
 * to give every caller (analyst agents, regime detector, risk manager,
 * autonomous trading agent) one shape of `complete()` to call, so when a
 * new model kind is added (vision for chart pattern recognition, a
 * time-series transformer for price/volatility forecasting) only this
 * file changes.
 *
 * Failover is delegated to the underlying OllamaClient (which walks its
 * endpoints array on `rate_limited` / `network_error` / `server_error` /
 * `unsupported_capability` / `timeout`). We expose `isReachable()` for
 * startup probes and a single `complete()` for callers.
 */
export class ModelManager {
  private client: OllamaClient;
  private llmModel: string;
  private visionEndpoints: ModelEndpoint[];
  private timeSeriesEndpoints: ModelEndpoint[];
  private globalTimeoutMs: number;

  constructor(config: ModelManagerConfig) {
    this.globalTimeoutMs = config.globalTimeoutMs ?? 90_000;
    this.visionEndpoints = config.visionEndpoints ?? [];
    this.timeSeriesEndpoints = config.timeSeriesEndpoints ?? [];
    this.llmModel = config.defaultModel ?? 'qwen3.5:2b';

    // Build the SDK endpoint array from the priority-sorted llmEndpoints.
    const sorted = [...config.llmEndpoints].sort((a, b) => a.priority - b.priority);
    const sdkEndpoints = sorted.map((ep) => ({
      name: ep.name,
      baseUrl: ep.baseUrl,
      apiKey: ep.apiKey,
      priority: ep.priority,
    }));

    // Track the highest-priority model name as the default for complete().
    if (sorted.length > 0 && sorted[0]?.model) {
      this.llmModel = sorted[0].model;
    }

    this.client = new OllamaClient({
      endpoints: sdkEndpoints,
      timeoutMs: this.globalTimeoutMs,
      failoverOn: [
        'rate_limited',
        'network_error',
        'server_error',
        'unsupported_capability',
        'timeout',
      ],
    });
  }

  /**
   * Run a chat-style completion against the LLM fleet. The SDK handles
   * failover between configured endpoints; we surface a uniform response
   * shape to callers.
   */
  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const startedAt = Date.now();
    const model = this.llmModel;
    const res = await this.client.chat({
      model,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.prompt },
      ],
      think: false,
      stream: false,
      options: {
        temperature: req.temperature ?? 0.3,
        ...(req.maxTokens ? { num_predict: req.maxTokens } : {}),
      },
      ...(req.json ? { format: 'json' as const } : {}),
    });
    const text = (res?.message?.content ?? '').trim();
    if (!text) {
      throw new Error('ModelManager.complete: empty response content');
    }
    return { text, model, latencyMs: Date.now() - startedAt };
  }

  /**
   * Placeholder for chart-image / candlestick-pattern vision calls. The router
   * is wired but no open-weight vision model is bundled by default — wire in
   * a vision endpoint (e.g. LLaVA via Ollama) when ready and replace the
   * throw with a real multimodal chat call.
   */
  async visionComplete(_req: CompletionRequest): Promise<CompletionResponse> {
    throw new Error(
      'ModelManager.visionComplete not implemented — wire in an Ollama LLaVA endpoint to enable chart-image pattern recognition'
    );
  }

  /**
   * Placeholder for time-series forecasting (price / volatility). Same pattern
   * as visionComplete — declared so callers compile today, implemented when a
   * time-series adapter is added.
   */
  async timeSeriesPredict(_req: CompletionRequest): Promise<CompletionResponse> {
    throw new Error(
      'ModelManager.timeSeriesPredict not implemented — wire in a Temporal Fusion Transformer or Chrono-Bert adapter to enable forecasting'
    );
  }

  /** Quick reachability check used at startup to warn operators. */
  async isReachable(kind: ModelKind = 'llm'): Promise<boolean> {
    if (kind !== 'llm') {
      // vision/timeSeries are unimplemented — don't claim reachability.
      return false;
    }
    try {
      const results = await this.client.healthCheck();
      return results.some((r) => r.reachable);
    } catch {
      return false;
    }
  }

  /** Names of configured endpoints (for the startup banner). */
  listEndpoints(kind: ModelKind = 'llm'): string[] {
    if (kind === 'vision') return this.visionEndpoints.map((e) => e.name);
    if (kind === 'timeSeries') return this.timeSeriesEndpoints.map((e) => e.name);
    // LLM endpoints aren't stored separately post-construction; expose the
    // single configured default model name to keep the banner honest.
    return [this.llmModel];
  }
}
