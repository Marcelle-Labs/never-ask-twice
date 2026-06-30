import { defineRailway, github, preserve, project, service } from "railway/iac";

export default defineRailway(() => {
  const _neverAskTwice = service("@never-ask-twice", {
    source: github("Marcelle-Labs/never-ask-twice"),
    build: { buildCommand: "pnpm build", buildEnvironment: "V3", builder: "RAILPACK" },
    start: "pnpm start",
    replicas: 1,
    networking: { privateNetworkEndpoint: "never-ask-twiceapi" },
    env: {
      DASHSCOPE_API_KEY: preserve(),
      DATABASE_URL: preserve(),
      MEMORY_TOKEN_BUDGET: preserve(),
      QWEN_BASE_URL: preserve(),
      QWEN_CHAT_MODEL: preserve(),
      QWEN_EMBEDDING_DIM: preserve(),
      QWEN_EMBEDDING_MODEL: preserve(),
    },
  });

  return project("never-ask-twice", {
    resources: [_neverAskTwice],
  });
});
