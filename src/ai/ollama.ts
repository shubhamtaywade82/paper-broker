import { OllamaClient } from '@nemesis-oss/ollama-sdk';
import type { OrderIntent } from './schemas.js';
import { OrderIntentSchema } from './schemas.js';

export interface OllamaConfig {
  baseUrl: string;
  model: string;
  timeoutMs?: number;
  debug?: boolean;
}

export interface GenerateSignalParams {
  symbol: string;
  candlesSummary: string;
  accountSummary: string;
}

const SYSTEM_PROMPT = `You are a crypto futures trading signal generator.
You analyze market data and return ONLY a JSON object, no other text.

Output must match this JSON schema exactly:
{
  "action": "OPEN_LONG" | "OPEN_SHORT" | "CLOSE_LONG" | "CLOSE_SHORT" | "HOLD",
  "symbol": "string",
  "confidence": number between 0 and 1,
  "stopLossPrice": "string" (optional),
  "takeProfitPrice": "string" (optional),
  "reasoning": "string" (optional)
}

Rules:
- HOLD unless there is a clear edge
- CLOSE_* only when already holding that position
- confidence reflects signal strength, not opinion
- stop/take profit must be decimal strings`;

export class OllamaSignalGenerator {
  private client: OllamaClient;
  private model: string;

  constructor(config: OllamaConfig) {
    this.model = config.model;
    this.client = new OllamaClient({
      baseUrl: config.baseUrl,
      timeoutMs: config.timeoutMs ?? 60_000,
      debug: config.debug ?? false,
    });
  }

  async ping(): Promise<boolean> {
    try {
      const models = await this.client.listModels();
      return models.some((m) => m.name === this.model);
    } catch {
      return false;
    }
  }

  async generateSignal(params: GenerateSignalParams): Promise<OrderIntent> {
    const userPrompt = [
      `Market data for ${params.symbol}:`,
      params.candlesSummary,
      ``,
      `Account state:`,
      params.accountSummary,
    ].join('\n');

    return this.client.generateWithSchema<OrderIntent>(
      {
        model: this.model,
        prompt: userPrompt,
        system: SYSTEM_PROMPT,
        options: {
          temperature: 0.2,
          top_p: 0.9,
        },
      },
      OrderIntentSchema
    );
  }
}