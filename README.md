# Agent Skill 提升度看板（Agent Skill Lift Dashboard）

这是基于 [darkrishabh/agent-skills-eval](https://github.com/darkrishabh/agent-skills-eval)
二次开发的作品项目。上游项目通过对比 `with_skill` 和 `without_skill` 两组运行结果来评估 Agent Skill；我在此基础上增加了面向产品决策的提升度看板，用来判断某个 Skill 是否真的改善了模型行为。

上游来源、许可证和改动范围见 [ATTRIBUTION.md](ATTRIBUTION.md)。

## 我新增了什么

- 增加 `--product-report` CLI 参数，在静态 HTML 报告中生成产品化提升度看板。
- 输出 `report/summary.json`，包含通过率提升、回归数量、延迟变化、token 变化、失败断言、最佳/最差案例，以及 tag/risk 分组。
- 增加可选 `--compare-workspace <path>`，支持跨迭代对比，适合作品展示或 CI 复盘。
- 为 eval 增加可选元数据：`tags?: string[]` 和 `risk?: "low" | "medium" | "high"`。
- 增加元数据解析、产物持久化、CLI 输出和 summary 生成相关测试。

## 产品定位

**用户：** 需要验证领域 Agent Skill 是否真正提升模型表现的 AI 产品经理或开发者平台 PM。

**问题：** 只凭直觉上线 Skill 风险很高。产品团队需要在启用前看到 baseline 提升、回归案例、成本/延迟变化和失败样例。

**决策支持：** 看板把问题具体化：哪些 Skill case 有提升、哪些发生回退、哪些属于高风险场景，以及上线前应该修复哪些失败断言。

## 产品报告用法

```bash
npx agent-skills-eval ./skills \
  --target gpt-4o-mini \
  --judge gpt-4o-mini \
  --baseline \
  --product-report
```

```bash
npx agent-skills-eval ./skills \
  --config agent-skills-eval.yaml \
  --product-report \
  --compare-workspace ./agent-skills-workspace/iteration-1
```

命令会在本次运行的 workspace 中写入 `report/index.html` 和 `report/summary.json`。

## Eval 元数据

```json
{
  "id": "top",
  "name": "top month",
  "tags": ["revenue", "csv"],
  "risk": "high",
  "prompt": "Find the top revenue month.",
  "assertions": ["The output names February."]
}
```

## 测试

```bash
npm test
npm run typecheck
```

## 局限性

- 看板只衡量当前 eval suite；如果 prompt 不具备代表性，不能证明真实产品收益。
- Judge 质量仍取决于配置的 judge 模型和断言设计。
- 成本指标来自 provider 返回的 token/延迟差异，不等同于真实账单核算。

---

<div align="center">

<img src="https://github.com/user-attachments/assets/094b8e11-e19e-4c96-ae82-ba701cfcf7e3" alt="agent-skills-eval：Agent Skills 测试运行器" width="100%" />

<br />

# agent-skills-eval

**面向 [Agent Skills](https://agentskills.io) 的测试运行器。**

写一个 `SKILL.md`，放入一些 eval，然后用实证方式判断：这个 skill 是否真的让模型在任务上变得更好。

[![npm version](https://img.shields.io/npm/v/agent-skills-eval.svg?style=flat-square&logo=npm&label=npm)](https://www.npmjs.com/package/agent-skills-eval)
[![CI](https://img.shields.io/github/actions/workflow/status/darkrishabh/agent-skills-eval/ci.yml?style=flat-square&logo=github&label=ci)](https://github.com/darkrishabh/agent-skills-eval/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![node](https://img.shields.io/node/v/agent-skills-eval.svg?style=flat-square&logo=nodedotjs&logoColor=white)](package.json)
[![docs](https://img.shields.io/badge/docs-GitHub%20Pages-0f766e?style=flat-square)](https://darkrishabh.github.io/agent-skills-eval/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

[文档](https://darkrishabh.github.io/agent-skills-eval/) · [快速开始](#快速开始) · [SDK](#sdk) · [agentskills.io](https://agentskills.io)

</div>

---

## 为什么需要它

[Agent Skills](https://agentskills.io) 是 Anthropic 提出的开放标准，用来为 agent 注入领域知识。它让发布一个 `SKILL.md` 变得很容易，也很容易让人默认 agent 已经更擅长这个任务。真正困难的是：*证明它确实变好了*。

`agent-skills-eval` 补上了这一环。它会用同一组 prompt 跑两次：一次是把 skill 加入上下文的 `with_skill`，一次是不带 skill 的 `without_skill`（baseline）。随后由 judge 模型分别评分，并生成并排对比报告。如果 skill 没有带来可衡量的差异，你会直接看到；如果确实有提升，也能留下证据。

它是 Agent Skills 生态的测试框架，不绑定某一个具体 agent runtime，因此只要你的 skill 能运行，就可以用它评测。

## 快速开始

```bash
npx agent-skills-eval ./skills \
  --target gpt-4o-mini \
  --judge gpt-4o-mini \
  --baseline \
  --strict
```

就这些。把它指向一个 skills 文件夹，指定 target 模型和 judge 模型，它就会生成包含完整产物的 workspace，以及一份静态 HTML 报告。

```text
agent-skills-workspace/
└── iteration-1/
    ├── meta.json            # 运行元数据
    ├── benchmark.json       # 每个 skill 的通过/失败汇总
    ├── eval-basic/
    │   ├── with_skill/      # 输出、耗时、judge 评分
    │   └── without_skill/   # 同上，但移除 skill 作为 baseline
    └── report/
        └── index.html       # 可视化报告
```

打开 `iteration-1/report/index.html`，就能得到一个有证据支撑的答案：这个 skill 到底有没有用。

## 你会得到什么

|  |  |
|---|---|
| **`with_skill` vs `without_skill`** | 每个 eval 都会跑两种模式，因此你能看到 skill 是否真的带来提升。 |
| **Judge 评分输出** | 可以使用任意聊天模型作为 judge。通过/失败基于断言和证据，而不是主观感觉。 |
| **TypeScript SDK + CLI** | CLI 可以一行接入 CI；SDK 可用于自定义流水线、provider 和 dashboard。 |
| **默认兼容 OpenAI API** | 可直接配合 OpenAI、Together、Groq、通过 OpenAI 兼容层接入的 Anthropic、本地 Llama 服务等使用。只要实现 OpenAI chat API 即可。 |
| **工具调用断言** | 不只评估文本生成，也能对会调用工具的 agent 做确定性检查。 |
| **可迁移产物** | 全流程输出 JSON + JSONL。今天运行，明天 diff，也可以接入你自己的 dashboard。 |
| **静态 HTML 报告** | 生成可直接发布的报告站点，不需要额外基础设施。 |
| **完整兼容规范** | 实现完整 [agentskills.io specification](https://agentskills.io/specification)：`SKILL.md` 校验、`evals/evals.json`、官方 `iteration-N` 产物布局和 frontmatter 规则。 |

## 安装

```bash
npm install agent-skills-eval
```

也可以不安装，直接运行：

```bash
npx agent-skills-eval --help
```

## 工作原理

核心逻辑很直接。对于 skill 中定义的每一个 eval：

```
                ┌─────────────────────────────┐
                │        同一个 prompt         │
                └───────────────┬─────────────┘
                                │
                ┌───────────────┴─────────────┐
                ▼                             ▼
        ┌──────────────┐              ┌──────────────┐
        │ with_skill   │              │without_skill │
        │ SKILL.md 在  │              │ baseline,    │
        │ 上下文中     │              │ 不带 skill   │
        └──────┬───────┘              └──────┬───────┘
               │                             │
               ▼                             ▼
           target 模型                  target 模型
               │                             │
               ▼                             ▼
             输出                          输出
               │                             │
               └──────────┬──────────────────┘
                          ▼
                   ┌─────────────┐
                   │  judge      │  用同一组断言
                   │  模型       │  分别评分
                   └──────┬──────┘
                          ▼
                    两侧分别通过/失败
```

judge 会读取 eval 中的 `expected_output` 和 `assertions`，并独立评分两侧输出。`--baseline` 参数用于启用对比；如果不加这个参数，只会运行 `with_skill`。

## YAML 配置

如果不是临时快速运行，建议在项目根目录放一个配置文件：

```yaml
# agent-skills-eval.yaml
root: ./skills
workspace: ./agent-skills-workspace
baseline: true
target: gpt-4o-mini
judge: gpt-4o-mini
baseUrl: https://api.openai.com/v1
apiKeyEnv: OPENAI_API_KEY
include:
  - "skills/**"
exclude:
  - "**/draft-*"
concurrency: 4
layout: iteration
strict: true
report:
  enabled: true
  title: Agent Skills Report
logging:
  format: pretty   # pretty | jsonl | silent
  verbose: false
  color: auto
targetParams:
  temperature: 0
judgeParams:
  temperature: 0
```

```bash
OPENAI_API_KEY=... npx agent-skills-eval --config agent-skills-eval.yaml
```

CLI 参数始终会覆盖配置文件中的值。

## SDK

如果需要在程序中使用，例如 CI 流水线、自定义 dashboard、多 skill 汇总，可以直接从 TypeScript 调用 evaluator：

```ts
import {
  OpenAICompatibleProvider,
  consoleReporter,
  evaluateSkills,
} from "agent-skills-eval";

const provider = new OpenAICompatibleProvider({
  baseUrl: "https://api.openai.com/v1",
  apiKey: process.env.OPENAI_API_KEY!,
  model: "gpt-4o-mini",
  providerName: "openai",
});

const result = await evaluateSkills({
  root: "./skills",
  workspace: "./agent-skills-workspace",
  baseline: true,
  concurrency: 4,
  workspaceLayout: "iteration",
  strict: true,
  target: { model: provider.model, provider },
  judge: { model: provider.model, provider },
  onEvent: consoleReporter(),
});

console.log(result);
```

也可以把事件以 JSONL 形式写入文件，供后续分析：

```ts
import { jsonlReporter } from "agent-skills-eval";

const reporter = jsonlReporter({ file: "./events.jsonl" });

await evaluateSkills({ /* ... */ onEvent: reporter.onEvent });
await reporter.close();
```

在代码中加载 YAML 配置：

```ts
import { loadConfigFile } from "agent-skills-eval";

const config = loadConfigFile("./agent-skills-eval.yaml");
```

## 自定义 Provider

只要实现 `Provider` 接口，就可以接入任意后端。这个接口包含五个字段和一个方法：

```ts
import type { Provider, ProviderResult } from "agent-skills-eval";

export const provider: Provider = {
  name: "my-provider",
  model: "my-model",
  async complete(prompt: string): Promise<ProviderResult> {
    return {
      provider: "my-provider",
      model: "my-model",
      output: "model output",
      latencyMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    };
  },
};
```

适用场景包括：本地模型服务（Ollama、vLLM、llama.cpp）、公司内部私有 API、单元测试中的 mock provider，或多个 provider 前面的路由层。

## Skill 目录结构

一个 skill 就是一个文件夹。最小结构只需要一个 `SKILL.md`；如果再加入 `evals/evals.json`，就可以开始评测。

```text
my-skill/
├── SKILL.md
├── references/
│   └── notes.md
├── scripts/
│   └── helper.sh
└── evals/
    ├── evals.json
    └── files/
        └── input.csv
```

`SKILL.md`:

```markdown
---
name: my-skill
description: 分析小型 CSV 文件。
license: MIT
compatibility: 适用于支持文本的聊天模型。
---

当收到 CSV 文件时，识别最重要的趋势，并引用相关行。
```

`evals/evals.json`:

```json
{
  "skill_name": "my-skill",
  "evals": [
    {
      "id": "basic",
      "name": "基础行为",
      "prompt": "使用附件数据总结收入情况。",
      "files": ["evals/files/input.csv"],
      "expected_output": "回答需要指出收入最高的月份。",
      "assertions": [
        "输出指出了收入最高的月份。"
      ]
    }
  ]
}
```

如果省略 `assertions` 但提供了 `expected_output`，SDK 会自动把 expected output 转成一条 judge 断言。因此，即使是最小化的 agentskills.io eval 文件，也能产生有意义的通过/失败评分。

## CLI 参数

```bash
npx agent-skills-eval [root] \
  --config agent-skills-eval.yaml \
  --workspace ./agent-skills-workspace \
  --baseline \
  --target gpt-4o-mini \
  --judge gpt-4o-mini \
  --base-url https://api.openai.com/v1 \
  --api-key-env OPENAI_API_KEY \
  --include "skills/**" \
  --exclude "**/draft-*" \
  --concurrency 4 \
  --layout iteration \
  --strict \
  --log-format pretty \
  --report
```

**日志模式**：`pretty` 适合人阅读，`jsonl` 适合机器处理，`silent` 适合安静的 CI 环境。

## 报告

静态 HTML 报告由磁盘产物生成，展示 skill 迭代时需要关注的信息：

- 按 skill 和 eval 展示通过率
- 按断言展示评分证据和 judge 推理
- 并排展示 `with_skill` 与 `without_skill` 的完整 target 输出
- prompt 和 judge prompt 明细
- 耗时和 token 使用情况
- 如有工具调用，也会展示工具调用信息

可以用 `--report-output`（或 YAML 中的 `report.output`）指定报告输出位置。

## agentskills.io 兼容性

完整实现 [agentskills.io](https://agentskills.io) 规范：

- `SKILL.md` YAML frontmatter：必填 `name` 和 `description`，可选 `license`、`compatibility`、`metadata`、`allowed-tools`
- 严格校验：名称长度、小写连字符格式、父目录匹配、description 长度、compatibility 长度
- 可选 `scripts/`、`references/` 和 `assets/` 目录：markdown references 会加入 skill 上下文，scripts 会通过 manifest 暴露
- `evals/evals.json` schema：`skill_name`、`evals[].id`、`prompt`、`expected_output`、`files`、`assertions`
- 官方产物布局：`iteration-N/<eval>/<mode>/outputs`、`timing.json`、`grading.json`、`benchmark.json`
- 通过 `with_skill` 和 `without_skill` 进行 baseline 对比

在规范之外，这个 SDK 还增加了：每个 eval 的 `defaults`、模型 `params`、工具定义、确定性的 `tool_assertions`，以及适合多 skill dashboard 的扁平化 `workspaceLayout: "flat"`。

## 示例

完整 skill 文件夹可参考 [`examples/basic-skill`](examples/basic-skill)，配置示例可参考 [`examples/agent-skills-eval.yaml`](examples/agent-skills-eval.yaml)。

## 开发

```bash
npm ci
npm test
npm pack --dry-run
```

## 文档

完整文档位于 **[darkrishabh.github.io/agent-skills-eval](https://darkrishabh.github.io/agent-skills-eval/)**，源码在 [`docs/`](docs)。本地预览：

```bash
python3 -m http.server 8080 --directory docs
```

## 贡献

欢迎提交 issue、PR 和 skill 示例。请参考 [CONTRIBUTING.md](CONTRIBUTING.md)、[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) 和 [SECURITY.md](SECURITY.md)。

## 许可证

MIT。见 [LICENSE](LICENSE)。

---

<div align="center">

为 [Agent Skills](https://agentskills.io) 生态而构建。

</div>
