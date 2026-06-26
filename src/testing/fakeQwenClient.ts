import type { DistilledFactCandidate } from "../contracts.js";
import type { QwenClient } from "../qwen/qwenClient.js";

function makeEmbedding(seed: number) {
  return Array.from({ length: 1024 }, (_, index) => (index === seed ? 1 : 0));
}

export class FakeQwenClient implements QwenClient {
  private readonly embeddings = new Map<string, number[]>();
  private readonly distillations = new Map<string, DistilledFactCandidate[]>();

  setEmbedding(input: string, seed: number) {
    this.embeddings.set(input, makeEmbedding(seed));
  }

  setDistillation(transcript: string, facts: DistilledFactCandidate[]) {
    this.distillations.set(transcript, facts);
  }

  async embed(input: string) {
    return this.embeddings.get(input) ?? makeEmbedding(0);
  }

  async chat() {
    return "ok";
  }

  async distill(input: { transcript: string }) {
    return this.distillations.get(input.transcript) ?? [];
  }

  async adjudicate() {
    return "supersede";
  }
}
