import { OllamaClient } from '@nemesis-oss/ollama-sdk';
import type { z } from 'zod';
import { AgentDecisionSchema, type AgentDecision } from './schemas.js';
import type { TradingEvent, TradingEventBus, TradingEventType } from '../strategy/market-state/index.js';

export type AgentMode = 'OBSERVER' | 'ANALYST' | 'SUPERVISOR';
export type ToolNamespace = 'market' | 'analysis' | 'research' | 'execution';

export interface AgentSkill {
  id: string;
  description: string;
  triggers: TradingEventType[];
  requiredEvidence: string[];
  allowedTools: string[];
  disqualifiers: string[];
  allowedDecisions: AgentDecision['action'][];
}

export interface AgentTool<TInput = unknown, TOutput = unknown> {
  name: string;
  namespace: ToolNamespace;
  description: string;
  execute: (input: TInput) => Promise<TOutput> | TOutput;
}

export interface AgentMemorySnapshot {
  marketState?: unknown;
  setupHistory?: unknown[];
  tradeHistory?: unknown[];
  regimeHistory?: unknown[];
  failedSetups?: unknown[];
  executionHistory?: unknown[];
  agentDecisions?: AgentDecision[];
}

export interface AgentRuntimeConfig {
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
  mode?: AgentMode;
  maxIterations?: number;
  decisionEvents?: TradingEventType[];
}

export interface AgentRuntimeRunInput {
  event: TradingEvent;
  facts: unknown;
  memory?: AgentMemorySnapshot;
}

export interface AgentRuntimeTrace {
  eventId: string;
  selectedSkillIds: string[];
  toolCalls: string[];
  decision: AgentDecision;
}

export type AgentReasoner = (prompt: string, schema: z.ZodTypeAny) => Promise<AgentDecision>;

const DEFAULT_DECISION_EVENTS: TradingEventType[] = [
  'SETUP_CREATED',
  'ENTRY_INTENT',
  'CONTINUATION_INTENT',
  'EXIT_INTENT',
  'ADD_INTENT',
  'REDUCE_INTENT',
  'REVERSE_INTENT',
  'REGIME_CHANGED',
];

const SYSTEM_POLICY = `You are an agentic crypto trading supervisor.
Use only deterministic facts, structured memory, allowed tools, and skill policies.
Never calculate indicators from raw candles. Never invent missing OI, funding, or flow values.
Never bypass risk controls or directly place orders.
NO_TRADE and WAIT are valid successful decisions.
Return only JSON that matches the requested schema.`;

export class AgentRuntime {
  private readonly tools = new Map<string, AgentTool>();
  private readonly skills = new Map<string, AgentSkill>();
  private readonly decisions: AgentDecision[] = [];
  private readonly config: Required<Pick<AgentRuntimeConfig, 'mode' | 'maxIterations'>> & AgentRuntimeConfig;
  private readonly reasoner: AgentReasoner;

  constructor(config: AgentRuntimeConfig, reasoner?: AgentReasoner) {
    this.config = {
      mode: config.mode ?? 'OBSERVER',
      maxIterations: config.maxIterations ?? 3,
      decisionEvents: config.decisionEvents ?? DEFAULT_DECISION_EVENTS,
      model: config.model,
      baseUrl: config.baseUrl,
      timeoutMs: config.timeoutMs,
    };

    if (reasoner) {
      this.reasoner = reasoner;
    } else {
      const client = new OllamaClient({ baseUrl: config.baseUrl ?? 'http://localhost:11434', timeoutMs: config.timeoutMs ?? 60_000 });
      this.reasoner = (prompt, schema) => client.generateWithSchema({ model: config.model, prompt, system: SYSTEM_POLICY, options: { temperature: 0.1, top_p: 0.9 } }, schema);
    }
  }

  registerTool(tool: AgentTool): void {
    if (tool.namespace === 'execution' && tool.name !== 'execution.propose') throw new Error('LLM execution namespace is restricted to execution.propose');
    this.tools.set(tool.name, tool);
  }

  registerSkill(skill: AgentSkill): void {
    this.skills.set(skill.id, skill);
  }

  shouldWake(event: TradingEvent): boolean {
    return (this.config.decisionEvents ?? DEFAULT_DECISION_EVENTS).includes(event.type);
  }

  async run(input: AgentRuntimeRunInput): Promise<AgentRuntimeTrace | null> {
    if (!this.shouldWake(input.event)) return null;
    const selectedSkills = [...this.skills.values()].filter((skill) => skill.triggers.includes(input.event.type));
    const toolCalls: string[] = [];
    const evidence = await this.collectEvidence(selectedSkills, input, toolCalls);
    const prompt = this.buildPrompt(input, selectedSkills, evidence);
    const decision = AgentDecisionSchema.parse(await this.reasoner(prompt, AgentDecisionSchema));
    this.enforceMode(decision);
    this.enforceSkills(decision, selectedSkills);
    this.decisions.push(decision);
    return { eventId: input.event.id, selectedSkillIds: selectedSkills.map((skill) => skill.id), toolCalls, decision };
  }

  attach(bus: TradingEventBus, factsForEvent: (event: TradingEvent) => unknown, onDecision: (trace: AgentRuntimeTrace) => void | Promise<void>): () => void {
    return bus.subscribeAll(async (event) => {
      const trace = await this.run({ event, facts: factsForEvent(event), memory: { agentDecisions: this.decisions } });
      if (trace) await onDecision(trace);
    });
  }

  private async collectEvidence(skills: AgentSkill[], input: AgentRuntimeRunInput, toolCalls: string[]): Promise<Record<string, unknown>> {
    if (this.config.mode === 'OBSERVER') return {};
    const allowedToolNames = new Set(skills.flatMap((skill) => skill.allowedTools));
    const evidence: Record<string, unknown> = {};
    for (const toolName of allowedToolNames) {
      if (toolCalls.length >= this.config.maxIterations) break;
      const tool = this.tools.get(toolName);
      if (!tool) continue;
      if (tool.namespace === 'execution' && this.config.mode !== 'SUPERVISOR') continue;
      evidence[toolName] = await tool.execute({ event: input.event, facts: input.facts, memory: input.memory });
      toolCalls.push(toolName);
    }
    return evidence;
  }

  private buildPrompt(input: AgentRuntimeRunInput, skills: AgentSkill[], evidence: Record<string, unknown>): string {
    return JSON.stringify({
      task: 'Evaluate deterministic trading event and return a structured decision.',
      mode: this.config.mode,
      event: input.event,
      facts: input.facts,
      memory: input.memory ?? {},
      skills,
      evidence,
      policy: {
        deterministicEngineDoes: ['structure', 'liquidity', 'displacement', 'regime', 'setup detection'],
        agentMayDo: ['select skill', 'request evidence', 'compare contradictions', 'rank setup', 'wait', 'reject', 'propose intent'],
        agentMustNotDo: ['calculate indicators', 'invent missing values', 'bypass risk', 'place arbitrary orders'],
      },
    });
  }

  private enforceMode(decision: AgentDecision): void {
    if (this.config.mode === 'OBSERVER' && !['WAIT', 'NO_TRADE'].includes(decision.action)) throw new Error(`Observer mode cannot emit ${decision.action}`);
    if (this.config.mode === 'ANALYST' && ['ENTER_LONG', 'ENTER_SHORT', 'EXIT_LONG', 'EXIT_SHORT', 'REDUCE', 'ADD', 'REVERSE'].includes(decision.action)) {
      throw new Error(`Analyst mode cannot emit execution action ${decision.action}`);
    }
  }

  private enforceSkills(decision: AgentDecision, skills: AgentSkill[]): void {
    if (skills.length === 0) return;
    const allowed = new Set(skills.flatMap((skill) => skill.allowedDecisions));
    if (!allowed.has(decision.action)) throw new Error(`Decision ${decision.action} is not allowed by selected skills`);
  }
}

export const breakoutRetestLongSkill: AgentSkill = {
  id: 'breakout-retest-long',
  description: 'Evaluate deterministic bullish breakout-retest facts without recalculating market structure.',
  triggers: ['SETUP_CREATED', 'ENTRY_INTENT'],
  requiredEvidence: ['regime', 'structure', 'liquidity', 'displacement', 'derivatives context'],
  allowedTools: ['analysis.structure', 'market.oi', 'market.funding', 'market.takerFlow'],
  disqualifiers: ['bearish structure break', 'excessive chase distance', 'severe funding crowding', 'contradictory flow'],
  allowedDecisions: ['ENTER_LONG', 'WAIT', 'NO_TRADE'],
};
