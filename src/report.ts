/**
 * Static HTML report generator (NYC-style) for skill eval runs.
 *
 * Reads the canonical flat workspace layout written by `evaluateSkills`:
 *
 *   <workspace>/
 *     <skill-slug>/
 *       meta.json
 *       benchmark.json
 *       eval-<slug>/
 *         with_skill/
 *           grading.json
 *           timing.json
 *           prompts.json
 *           outputs/response.txt
 *         without_skill/...   (only if --baseline)
 *
 * Emits a single self-contained HTML file at `<workspace>/report/index.html`.
 * No external assets, no JavaScript runtime, no build step. Uses `<details>`
 * for collapsibles so it works in any browser, including offline.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { BenchmarkJson, GradingJson, ToolCall } from "./types.js";

export interface GenerateReportArgs {
  /** Workspace directory that contains per-skill subfolders. */
  workspace: string;
  /** Override output dir. Defaults to `<workspace>/report`. */
  output?: string;
  /** Display title in the report header. Defaults to "Agent Skills Eval report". */
  title?: string;
  /** Target model used for the run, surfaced in the header for context. */
  target?: string;
  /** Judge model used for the run, surfaced in the header for context. */
  judge?: string;
  /** Include product-facing lift scorecards and write summary.json. */
  productReport?: boolean;
  /** Optional previous workspace used for run-over-run comparison. */
  compareWorkspace?: string;
}

export interface GenerateReportResult {
  reportPath: string;
  summaryPath?: string;
  skills: number;
  evals: number;
}

interface EvalMetaFile {
  id?: string | number;
  name?: string;
  slug?: string;
  tags?: string[];
  risk?: "low" | "medium" | "high";
}

interface RunPromptsFile {
  system?: string;
  user: string;
  judgePrompt?: string;
  fileCount: number;
}

interface TimingFile {
  total_tokens: number;
  duration_ms: number;
}

interface SkillMeta {
  name: string;
  slug: string;
  relPath: string;
  target?: string;
  judge?: string;
  modes?: string[];
  generated_at?: string;
}

interface ReportRun {
  mode: "with_skill" | "without_skill";
  output: string;
  grading: GradingJson;
  timing: TimingFile;
  prompts?: RunPromptsFile;
  toolCalls?: ToolCall[];
}

interface ReportEval {
  slug: string;
  metadata?: EvalMetaFile;
  modes: ReportRun[];
}

interface ReportSkill {
  meta: SkillMeta;
  benchmark?: BenchmarkJson;
  evals: ReportEval[];
  totals: {
    passed: number;
    failed: number;
    total: number;
    passRate: number;
    avgDurationMs: number;
    avgTokens: number;
  };
}

function readJson<T>(filePath: string): T | undefined {
  if (!existsSync(filePath)) return undefined;
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as T;
  } catch {
    return undefined;
  }
}

function readText(filePath: string): string {
  if (!existsSync(filePath)) return "";
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

function isSkillDir(dir: string): boolean {
  return existsSync(path.join(dir, "meta.json")) || existsSync(path.join(dir, "benchmark.json"));
}

function collectSkill(skillDir: string): ReportSkill | undefined {
  if (!statSync(skillDir).isDirectory()) return undefined;
  const meta = readJson<SkillMeta>(path.join(skillDir, "meta.json")) ?? {
    name: path.basename(skillDir),
    slug: path.basename(skillDir),
    relPath: skillDir,
  };
  const benchmark = readJson<BenchmarkJson>(path.join(skillDir, "benchmark.json"));

  const entries = readdirSync(skillDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("eval-"))
    .sort((a, b) => a.name.localeCompare(b.name));

  const evals: ReportEval[] = [];
  let passed = 0;
  let failed = 0;
  let totalDuration = 0;
  let totalTokens = 0;
  let withSkillRuns = 0;

  for (const entry of entries) {
    const evalDir = path.join(skillDir, entry.name);
    const metadata = readJson<EvalMetaFile>(path.join(evalDir, "eval.json"));
    const modes: ReportRun[] = [];

    for (const mode of ["with_skill", "without_skill"] as const) {
      const runDir = path.join(evalDir, mode);
      if (!existsSync(runDir)) continue;
      const grading = readJson<GradingJson>(path.join(runDir, "grading.json"));
      const timing = readJson<TimingFile>(path.join(runDir, "timing.json"));
      if (!grading || !timing) continue;
      const prompts = readJson<RunPromptsFile>(path.join(runDir, "prompts.json"));
      const toolCalls = readJson<ToolCall[]>(path.join(runDir, "tool_calls.json"));
      const output =
        readText(path.join(runDir, "outputs", "raw_output.txt")) ||
        readText(path.join(runDir, "outputs", "response.txt"));
      modes.push({ mode, output, grading, timing, prompts, toolCalls });

      if (mode === "with_skill") {
        passed += grading.summary.passed;
        failed += grading.summary.failed;
        totalDuration += timing.duration_ms;
        totalTokens += timing.total_tokens;
        withSkillRuns += 1;
      }
    }

    if (modes.length > 0) {
      evals.push({ slug: entry.name, metadata, modes });
    }
  }

  const total = passed + failed;
  return {
    meta,
    benchmark,
    evals,
    totals: {
      passed,
      failed,
      total,
      passRate: total === 0 ? 1 : passed / total,
      avgDurationMs: withSkillRuns === 0 ? 0 : totalDuration / withSkillRuns,
      avgTokens: withSkillRuns === 0 ? 0 : totalTokens / withSkillRuns,
    },
  };
}

function collectReport(workspace: string): ReportSkill[] {
  const root = path.resolve(workspace);
  if (!existsSync(root)) return [];
  if (isSkillDir(root)) {
    const skill = collectSkill(root);
    return skill ? [skill] : [];
  }
  const out: ReportSkill[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "report" || entry.name === ".history" || entry.name.startsWith(".")) continue;
    const dir = path.join(root, entry.name);
    if (!isSkillDir(dir)) continue;
    const skill = collectSkill(dir);
    if (skill) out.push(skill);
  }
  return out.sort((a, b) => a.totals.passRate - b.totals.passRate); // failures first
}

// ─── HTML rendering ──────────────────────────────────────────────────────────

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

const RISK_LABELS: Record<ProductEvalCase["risk"], string> = {
  low: "低风险",
  medium: "中风险",
  high: "高风险",
};

function ms(value: number): string {
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(2)}s`;
}

function rateClass(passRate: number): string {
  if (passRate >= 0.8) return "ok";
  if (passRate >= 0.5) return "warn";
  return "bad";
}

function renderBar(passRate: number): string {
  const cls = rateClass(passRate);
  const width = Math.round(passRate * 100);
  return `<div class="bar ${cls}"><div class="fill" style="width:${width}%"></div></div>`;
}

function renderSkillRow(skill: ReportSkill): string {
  const t = skill.totals;
  const cls = rateClass(t.passRate);
  return `
    <tr class="skill-row ${cls}">
      <td><a href="#skill-${escapeHtml(skill.meta.slug)}">${escapeHtml(skill.meta.name)}</a>
          <div class="muted">${escapeHtml(skill.meta.relPath)}</div></td>
      <td class="num">${skill.evals.length}</td>
      <td class="num">${t.passed}/${t.total}</td>
      <td class="num">${pct(t.passRate)}</td>
      <td class="bar-cell">${renderBar(t.passRate)}</td>
      <td class="num">${ms(t.avgDurationMs)}</td>
      <td class="num">${Math.round(t.avgTokens)}</td>
    </tr>
  `;
}

function renderAssertionsTable(grading: GradingJson): string {
  if (grading.assertion_results.length === 0) {
    return `<p class="muted">没有断言。</p>`;
  }
  const rows = grading.assertion_results
    .map(
      (r, i) => `
        <tr class="${r.passed ? "ok" : "bad"}">
          <td class="num">${i + 1}</td>
          <td>${r.passed ? "<span class='check'>\u2713</span>" : "<span class='x'>\u2717</span>"}</td>
          <td>${escapeHtml(r.text)}</td>
          <td><span class="evidence">${escapeHtml(r.evidence || "—")}</span></td>
        </tr>`
    )
    .join("\n");
  return `<table class="assertions"><thead><tr><th>#</th><th></th><th>断言</th><th>证据</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderToolCallsPanel(calls: ToolCall[] | undefined): string {
  if (!calls || calls.length === 0) return "";
  const rows = calls
    .map((c, i) => {
      const args = c.parsedArguments !== undefined
        ? JSON.stringify(c.parsedArguments, null, 2)
        : c.function.arguments || "(empty)";
      return `
        <tr>
          <td class="num">${i + 1}</td>
          <td class="tool-name">${escapeHtml(c.function.name)}</td>
          <td><pre class="tool-args">${escapeHtml(args)}</pre></td>
        </tr>`;
    })
    .join("\n");
  return `
    <details class="tools" open>
      <summary>工具调用 (${calls.length})</summary>
      <table class="tool-calls">
        <thead><tr><th>#</th><th>工具</th><th>参数</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </details>
  `;
}

function renderRun(run: ReportRun): string {
  const summary = run.grading.summary;
  const passed = summary.failed === 0 && summary.total > 0;
  const status = summary.total === 0 ? "n/a" : passed ? "PASS" : "FAIL";
  const statusCls = summary.total === 0 ? "muted" : passed ? "ok" : "bad";
  return `
    <section class="run">
      <header class="run-head">
        <span class="mode mode-${run.mode}">${run.mode}</span>
        <span class="status ${statusCls}">${status}</span>
        <span class="muted">${ms(run.timing.duration_ms)} · ${run.timing.total_tokens} tokens · ${summary.passed}/${summary.total}</span>
      </header>
      ${
        run.prompts?.system
          ? `<details class="prompt"><summary>系统提示词</summary><pre>${escapeHtml(run.prompts.system)}</pre></details>`
          : ""
      }
      <details class="prompt" open><summary>用户提示词</summary><pre>${escapeHtml(run.prompts?.user ?? "(unknown)")}</pre></details>
      <details class="output" open><summary>模型输出</summary><pre>${escapeHtml(run.output || "(empty)")}</pre></details>
      ${renderToolCallsPanel(run.toolCalls)}
      ${renderAssertionsTable(run.grading)}
      ${
        run.prompts?.judgePrompt
          ? `<details class="judge"><summary>裁判提示词</summary><pre>${escapeHtml(run.prompts.judgePrompt)}</pre></details>`
          : ""
      }
    </section>
  `;
}

function renderEval(ev: ReportEval): string {
  const totalAssertions = ev.modes.reduce((sum, m) => sum + m.grading.summary.total, 0);
  const passedAssertions = ev.modes.reduce((sum, m) => sum + m.grading.summary.passed, 0);
  const allPassed = ev.modes.every((m) => m.grading.summary.failed === 0 && m.grading.summary.total > 0);
  const cls = allPassed ? "ok" : "bad";
  return `
    <details class="eval ${cls}">
      <summary>
        <span class="eval-status">${allPassed ? "\u2713" : "\u2717"}</span>
        <span class="eval-name">${escapeHtml(ev.slug)}</span>
        <span class="muted">${passedAssertions}/${totalAssertions} assertions</span>
      </summary>
      <div class="eval-body">${ev.modes.map(renderRun).join("\n")}</div>
    </details>
  `;
}

function renderSkillSection(skill: ReportSkill): string {
  const t = skill.totals;
  const benchmarkBlock = skill.benchmark?.run_summary.delta
    ? (() => {
        const d = skill.benchmark!.run_summary.delta!;
        const sign = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;
        const ppDelta = d.pass_rate * 100;
        const cls = ppDelta > 0 ? "ok" : ppDelta < 0 ? "bad" : "muted";
        return `<div class="delta ${cls}">相对 baseline：通过率 ${sign(ppDelta)}pp · 时间 ${sign(d.time_seconds)}s · tokens ${sign(d.tokens)}</div>`;
      })()
    : "";
  return `
    <article class="skill" id="skill-${escapeHtml(skill.meta.slug)}">
      <header>
        <h2>${escapeHtml(skill.meta.name)} <span class="badge ${rateClass(t.passRate)}">${pct(t.passRate)}</span></h2>
        <div class="muted">${escapeHtml(skill.meta.relPath)}</div>
        <div class="muted">${t.passed}/${t.total} 个断言通过 · ${skill.evals.length} 个 eval · 平均 ${ms(t.avgDurationMs)} · 平均 ${Math.round(t.avgTokens)} tokens</div>
        ${benchmarkBlock}
      </header>
      <div class="evals">${skill.evals.map(renderEval).join("\n")}</div>
    </article>
  `;
}

interface ProductEvalCase {
  skill: string;
  evalSlug: string;
  evalName: string;
  tags: string[];
  risk: "low" | "medium" | "high";
  withSkillPassRate: number;
  withoutSkillPassRate?: number;
  passRateDelta?: number;
  latencyDeltaMs?: number;
  tokenDelta?: number;
  regression: boolean;
  failedAssertions: string[];
}

interface ProductGroupSummary {
  count: number;
  averagePassRate: number;
  averageLift: number;
  regressions: number;
  failedAssertions: number;
}

interface ProductSummary {
  generated_at: string;
  workspace: string;
  compared_workspace?: string;
  totals: {
    skills: number;
    evals: number;
    assertions: number;
    passRate: number;
    baselineEvals: number;
    averagePassRateDelta: number;
    regressionCount: number;
    averageLatencyDeltaMs: number;
    averageTokenDelta: number;
    failedAssertions: number;
  };
  riskGroups: Record<string, ProductGroupSummary>;
  tagGroups: Record<string, ProductGroupSummary>;
  bestCases: ProductEvalCase[];
  worstCases: ProductEvalCase[];
  workspaceComparison?: {
    currentPassRate: number;
    previousPassRate: number;
    delta: number;
  };
  cases: ProductEvalCase[];
}

function runFor(ev: ReportEval, mode: ReportRun["mode"]): ReportRun | undefined {
  return ev.modes.find((run) => run.mode === mode);
}

function averageNumbers(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundMetric(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function passRateForSkills(skills: ReportSkill[]): number {
  const total = skills.reduce((sum, skill) => sum + skill.totals.total, 0);
  if (total === 0) return 1;
  return skills.reduce((sum, skill) => sum + skill.totals.passed, 0) / total;
}

function productCases(skills: ReportSkill[]): ProductEvalCase[] {
  const cases: ProductEvalCase[] = [];
  for (const skill of skills) {
    for (const ev of skill.evals) {
      const withSkill = runFor(ev, "with_skill");
      if (!withSkill) continue;
      const withoutSkill = runFor(ev, "without_skill");
      const failedAssertions = withSkill.grading.assertion_results
        .filter((assertion) => !assertion.passed)
        .map((assertion) => assertion.text);
      const withRate = withSkill.grading.summary.pass_rate;
      const withoutRate = withoutSkill?.grading.summary.pass_rate;
      cases.push({
        skill: skill.meta.name,
        evalSlug: ev.slug,
        evalName: ev.metadata?.name ?? ev.slug,
        tags: ev.metadata?.tags ?? [],
        risk: ev.metadata?.risk ?? "medium",
        withSkillPassRate: withRate,
        withoutSkillPassRate: withoutRate,
        passRateDelta: withoutRate === undefined ? undefined : roundMetric(withRate - withoutRate),
        latencyDeltaMs: withoutSkill
          ? roundMetric(withSkill.timing.duration_ms - withoutSkill.timing.duration_ms)
          : undefined,
        tokenDelta: withoutSkill
          ? roundMetric(withSkill.timing.total_tokens - withoutSkill.timing.total_tokens)
          : undefined,
        regression: withoutRate !== undefined && withRate < withoutRate,
        failedAssertions,
      });
    }
  }
  return cases;
}

function summarizeGroup(cases: ProductEvalCase[]): ProductGroupSummary {
  return {
    count: cases.length,
    averagePassRate: roundMetric(
      averageNumbers(cases.map((item) => item.withSkillPassRate))
    ),
    averageLift: roundMetric(
      averageNumbers(
        cases
          .map((item) => item.passRateDelta)
          .filter((value): value is number => value !== undefined)
      )
    ),
    regressions: cases.filter((item) => item.regression).length,
    failedAssertions: cases.reduce(
      (sum, item) => sum + item.failedAssertions.length,
      0
    ),
  };
}

function groupByRisk(cases: ProductEvalCase[]): Record<string, ProductGroupSummary> {
  const groups: Record<string, ProductEvalCase[]> = {
    high: [],
    medium: [],
    low: [],
  };
  for (const item of cases) groups[item.risk].push(item);
  return Object.fromEntries(
    Object.entries(groups).map(([key, value]) => [key, summarizeGroup(value)])
  );
}

function groupByTag(cases: ProductEvalCase[]): Record<string, ProductGroupSummary> {
  const groups: Record<string, ProductEvalCase[]> = {};
  for (const item of cases) {
    const tags = item.tags.length > 0 ? item.tags : ["untagged"];
    for (const tag of tags) {
      groups[tag] ??= [];
      groups[tag].push(item);
    }
  }
  return Object.fromEntries(
    Object.entries(groups)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => [key, summarizeGroup(value)])
  );
}

function buildProductSummary(args: GenerateReportArgs, skills: ReportSkill[], generatedAt: string): ProductSummary {
  const cases = productCases(skills);
  const baselineCases = cases.filter((item) => item.passRateDelta !== undefined);
  const totalAssertions = skills.reduce((sum, skill) => sum + skill.totals.total, 0);
  const failedAssertions = cases.reduce((sum, item) => sum + item.failedAssertions.length, 0);
  const sortedByLift = [...baselineCases].sort(
    (a, b) => (b.passRateDelta ?? 0) - (a.passRateDelta ?? 0)
  );
  const summary: ProductSummary = {
    generated_at: generatedAt,
    workspace: path.resolve(args.workspace),
    compared_workspace: args.compareWorkspace ? path.resolve(args.compareWorkspace) : undefined,
    totals: {
      skills: skills.length,
      evals: cases.length,
      assertions: totalAssertions,
      passRate: roundMetric(passRateForSkills(skills)),
      baselineEvals: baselineCases.length,
      averagePassRateDelta: roundMetric(
        averageNumbers(baselineCases.map((item) => item.passRateDelta ?? 0))
      ),
      regressionCount: baselineCases.filter((item) => item.regression).length,
      averageLatencyDeltaMs: roundMetric(
        averageNumbers(
          baselineCases
            .map((item) => item.latencyDeltaMs)
            .filter((value): value is number => value !== undefined)
        )
      ),
      averageTokenDelta: roundMetric(
        averageNumbers(
          baselineCases
            .map((item) => item.tokenDelta)
            .filter((value): value is number => value !== undefined)
        )
      ),
      failedAssertions,
    },
    riskGroups: groupByRisk(cases),
    tagGroups: groupByTag(cases),
    bestCases: sortedByLift.slice(0, 5),
    worstCases: [...sortedByLift].reverse().slice(0, 5),
    cases,
  };

  if (args.compareWorkspace) {
    const previous = collectReport(args.compareWorkspace);
    if (previous.length > 0) {
      const previousPassRate = passRateForSkills(previous);
      const currentPassRate = passRateForSkills(skills);
      summary.workspaceComparison = {
        currentPassRate: roundMetric(currentPassRate),
        previousPassRate: roundMetric(previousPassRate),
        delta: roundMetric(currentPassRate - previousPassRate),
      };
    }
  }

  return summary;
}

function signedPct(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(1)}pp`;
}

function signedNumber(value: number, suffix = ""): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}${suffix}`;
}

function renderProductCaseRows(cases: ProductEvalCase[]): string {
  if (cases.length === 0) {
    return `<tr><td colspan="7" class="muted">没有 baseline 对比案例。</td></tr>`;
  }
  return cases
    .map((item) => {
      const delta = item.passRateDelta ?? 0;
      const deltaClass = delta > 0 ? "ok" : delta < 0 ? "bad" : "muted";
      return `
        <tr>
          <td>${escapeHtml(item.skill)}</td>
          <td>${escapeHtml(item.evalName)}</td>
          <td><span class="risk risk-${item.risk}">${RISK_LABELS[item.risk]}</span></td>
          <td>${escapeHtml(item.tags.join(", ") || "未标记")}</td>
          <td class="${deltaClass}">${signedPct(delta)}</td>
          <td>${item.latencyDeltaMs === undefined ? "无" : signedNumber(item.latencyDeltaMs, "ms")}</td>
          <td>${item.failedAssertions.length}</td>
        </tr>`;
    })
    .join("\n");
}

function renderProductSummary(summary: ProductSummary): string {
  const t = summary.totals;
  const comparison = summary.workspaceComparison
    ? `<div class="product-note">相对上一次 workspace 的通过率变化：<strong>${signedPct(summary.workspaceComparison.delta)}</strong></div>`
    : "";
  const tagRows = Object.entries(summary.tagGroups)
    .map(
      ([tag, group]) => `
        <tr>
          <td>${escapeHtml(tag)}</td>
          <td class="num">${group.count}</td>
          <td class="num">${pct(group.averagePassRate)}</td>
          <td class="num">${signedPct(group.averageLift)}</td>
          <td class="num">${group.regressions}</td>
          <td class="num">${group.failedAssertions}</td>
        </tr>`
    )
    .join("\n");

  return `
    <section class="product-dashboard">
      <h2>Agent Skill 提升度看板</h2>
      <p class="muted">衡量每个 Agent Skill 相比 baseline 是否真正改善任务结果。</p>
      <div class="product-grid">
        <div class="product-card"><span>Skill 通过率</span><strong>${pct(t.passRate)}</strong></div>
        <div class="product-card"><span>相对 baseline 平均提升</span><strong>${signedPct(t.averagePassRateDelta)}</strong></div>
        <div class="product-card"><span>回归案例</span><strong>${t.regressionCount}</strong></div>
        <div class="product-card"><span>延迟变化</span><strong>${signedNumber(t.averageLatencyDeltaMs, "ms")}</strong></div>
        <div class="product-card"><span>Token 变化</span><strong>${signedNumber(t.averageTokenDelta)}</strong></div>
        <div class="product-card"><span>失败断言</span><strong>${t.failedAssertions}</strong></div>
      </div>
      ${comparison}
      <h3>提升最明显案例</h3>
      <table class="product-table">
        <thead><tr><th>Skill</th><th>Eval</th><th>风险</th><th>标签</th><th>提升</th><th>延迟</th><th>失败</th></tr></thead>
        <tbody>${renderProductCaseRows(summary.bestCases)}</tbody>
      </table>
      <h3>表现最差案例</h3>
      <table class="product-table">
        <thead><tr><th>Skill</th><th>Eval</th><th>风险</th><th>标签</th><th>提升</th><th>延迟</th><th>失败</th></tr></thead>
        <tbody>${renderProductCaseRows(summary.worstCases)}</tbody>
      </table>
      <h3>标签分组</h3>
      <table class="product-table">
        <thead><tr><th>标签</th><th class="num">案例数</th><th class="num">通过率</th><th class="num">提升</th><th class="num">回归</th><th class="num">失败断言</th></tr></thead>
        <tbody>${tagRows}</tbody>
      </table>
    </section>
  `;
}

const STYLES = `
  :root {
    --fg: #1a1f24;
    --muted: #6a737d;
    --bg: #ffffff;
    --bg-alt: #f6f8fa;
    --border: #e1e4e8;
    --ok: #1a7f37;
    --warn: #b08800;
    --bad: #cf222e;
    --ok-bg: #dafbe1;
    --warn-bg: #fff8c5;
    --bad-bg: #ffebe9;
    --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; color: var(--fg); background: var(--bg); }
  header.hero { background: linear-gradient(180deg, #fafbfc 0%, #f0f2f5 100%); border-bottom: 1px solid var(--border); padding: 24px 32px; }
  header.hero h1 { margin: 0 0 4px; font-size: 22px; }
  header.hero .meta { color: var(--muted); font-size: 13px; }
  header.hero .totals { margin-top: 16px; display: flex; gap: 16px; flex-wrap: wrap; }
  header.hero .stat { background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 12px 16px; min-width: 120px; }
  header.hero .stat .label { display: block; font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
  header.hero .stat .value { display: block; font-size: 22px; font-weight: 600; margin-top: 2px; }
  header.hero .stat.ok .value { color: var(--ok); }
  header.hero .stat.bad .value { color: var(--bad); }
  main { padding: 24px 32px; max-width: 1200px; margin: 0 auto; }
  h2 { margin: 0 0 4px; font-size: 18px; }
  .muted { color: var(--muted); font-size: 12px; }
  table.summary { width: 100%; border-collapse: collapse; margin-bottom: 32px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  table.summary th, table.summary td { padding: 10px 12px; border-bottom: 1px solid var(--border); text-align: left; }
  table.summary th { background: var(--bg-alt); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
  table.summary td.num { text-align: right; font-variant-numeric: tabular-nums; }
  table.summary tr.skill-row.bad { background: var(--bad-bg); }
  table.summary tr.skill-row.warn { background: var(--warn-bg); }
  table.summary tr.skill-row.ok td { background: transparent; }
  table.summary tr.skill-row a { color: var(--fg); text-decoration: none; font-weight: 500; }
  table.summary tr.skill-row a:hover { text-decoration: underline; }
  .bar { width: 100px; height: 10px; background: var(--bg-alt); border-radius: 5px; overflow: hidden; }
  .bar .fill { height: 100%; }
  .bar.ok .fill { background: var(--ok); }
  .bar.warn .fill { background: var(--warn); }
  .bar.bad .fill { background: var(--bad); }
  article.skill { background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 20px; margin-bottom: 20px; }
  article.skill header h2 .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 500; vertical-align: middle; margin-left: 8px; }
  article.skill header h2 .badge.ok { background: var(--ok-bg); color: var(--ok); }
  article.skill header h2 .badge.warn { background: var(--warn-bg); color: var(--warn); }
  article.skill header h2 .badge.bad { background: var(--bad-bg); color: var(--bad); }
  article.skill .delta { margin-top: 8px; font-size: 13px; }
  article.skill .delta.ok { color: var(--ok); }
  article.skill .delta.bad { color: var(--bad); }
  details.eval { border: 1px solid var(--border); border-radius: 6px; margin-top: 12px; }
  details.eval > summary { padding: 10px 14px; cursor: pointer; display: flex; gap: 10px; align-items: center; }
  details.eval[open] > summary { border-bottom: 1px solid var(--border); }
  details.eval.bad > summary { background: var(--bad-bg); }
  details.eval.ok > summary { background: var(--ok-bg); }
  details.eval .eval-status { font-weight: 600; }
  details.eval.bad .eval-status { color: var(--bad); }
  details.eval.ok .eval-status { color: var(--ok); }
  .eval-body { padding: 12px 16px; }
  .run { padding: 12px 0; border-top: 1px dashed var(--border); }
  .run:first-child { border-top: none; padding-top: 0; }
  .run-head { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
  .mode { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.04em; }
  .mode-with_skill { background: #ddf4ff; color: #0969da; }
  .mode-without_skill { background: #fff1e5; color: #bc4c00; }
  .status.ok { color: var(--ok); font-weight: 600; }
  .status.bad { color: var(--bad); font-weight: 600; }
  .run details > summary { cursor: pointer; font-size: 12px; color: var(--muted); padding: 4px 0; }
  .run details[open] > summary { color: var(--fg); }
  .run pre { background: var(--bg-alt); border: 1px solid var(--border); border-radius: 6px; padding: 10px 12px; font-family: var(--mono); font-size: 12px; line-height: 1.45; overflow-x: auto; white-space: pre-wrap; word-break: break-word; max-height: 400px; overflow-y: auto; }
  table.assertions { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 13px; }
  table.assertions th, table.assertions td { padding: 6px 8px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; }
  table.assertions th { background: var(--bg-alt); font-size: 11px; text-transform: uppercase; color: var(--muted); }
  table.assertions tr.bad td { background: var(--bad-bg); }
  table.assertions .check { color: var(--ok); font-weight: 600; }
  table.assertions .x { color: var(--bad); font-weight: 600; }
  table.assertions .evidence { color: var(--muted); font-size: 12px; }
  details.tools { margin: 12px 0; }
  details.tools > summary { cursor: pointer; font-size: 12px; color: var(--muted); padding: 4px 0; }
  details.tools[open] > summary { color: var(--fg); font-weight: 500; }
  table.tool-calls { width: 100%; border-collapse: collapse; margin: 6px 0 8px; font-size: 13px; }
  table.tool-calls th, table.tool-calls td { padding: 6px 8px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; }
  table.tool-calls th { background: var(--bg-alt); font-size: 11px; text-transform: uppercase; color: var(--muted); }
  table.tool-calls .tool-name { font-family: var(--mono); color: #b08800; font-weight: 600; }
  pre.tool-args { background: var(--bg-alt); border: 1px solid var(--border); border-radius: 4px; padding: 6px 8px; margin: 0; font-family: var(--mono); font-size: 12px; line-height: 1.4; overflow-x: auto; white-space: pre-wrap; word-break: break-word; max-height: 240px; overflow-y: auto; }
  .product-dashboard { background: #f8fbff; border: 1px solid var(--border); border-radius: 8px; padding: 20px; margin-bottom: 24px; }
  .product-dashboard h2 { margin-bottom: 2px; }
  .product-dashboard h3 { margin: 20px 0 8px; font-size: 14px; }
  .product-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 16px 0; }
  .product-card { background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; }
  .product-card span { display: block; font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
  .product-card strong { display: block; margin-top: 4px; font-size: 22px; }
  .product-note { margin: 8px 0 12px; color: var(--muted); }
  table.product-table { width: 100%; border-collapse: collapse; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  table.product-table th, table.product-table td { padding: 8px 10px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; }
  table.product-table th { background: var(--bg-alt); font-size: 11px; text-transform: uppercase; color: var(--muted); }
  table.product-table .num { text-align: right; font-variant-numeric: tabular-nums; }
  .risk { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 600; text-transform: uppercase; }
  .risk-high { color: var(--bad); background: var(--bad-bg); }
  .risk-medium { color: var(--warn); background: var(--warn-bg); }
  .risk-low { color: var(--ok); background: var(--ok-bg); }
  .empty { padding: 60px 20px; text-align: center; color: var(--muted); }
`;

export function generateReport(args: GenerateReportArgs): GenerateReportResult {
  const skills = collectReport(args.workspace);
  const totalEvals = skills.reduce((sum, s) => sum + s.evals.length, 0);
  const totalAssertions = skills.reduce((sum, s) => sum + s.totals.total, 0);
  const totalPassed = skills.reduce((sum, s) => sum + s.totals.passed, 0);
  const totalFailed = totalAssertions - totalPassed;
  const overallRate = totalAssertions === 0 ? 1 : totalPassed / totalAssertions;
  const generatedAt = new Date().toISOString();

  const title = args.title ?? "Agent Skills 评测报告";
  const outputDir = args.output ?? path.join(args.workspace, "report");
  let summaryPath: string | undefined;
  const productSummary = args.productReport
    ? buildProductSummary(args, skills, generatedAt)
    : undefined;
  const productDashboard = productSummary ? renderProductSummary(productSummary) : "";
  if (productSummary) {
    mkdirSync(outputDir, { recursive: true });
    summaryPath = path.join(outputDir, "summary.json");
    writeFileSync(
      summaryPath,
      `${JSON.stringify(productSummary, null, 2)}\n`,
      "utf-8"
    );
  }
  const summaryRows = skills.map(renderSkillRow).join("\n");
  const detailSections = skills.map(renderSkillSection).join("\n");

  const body =
    skills.length === 0
      ? `<div class="empty">在 <code>${escapeHtml(args.workspace)}</code> 中没有找到 Skill 评测产物。</div>`
      : `
        ${productDashboard}
        <table class="summary">
          <thead>
            <tr>
              <th>Skill</th>
              <th class="num">Evals</th>
              <th class="num">通过</th>
              <th class="num">通过率</th>
              <th></th>
              <th class="num">平均耗时</th>
              <th class="num">平均 tokens</th>
            </tr>
          </thead>
          <tbody>${summaryRows}</tbody>
        </table>
        ${detailSections}
      `;

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>${STYLES}</style>
</head>
<body>
  <header class="hero">
    <h1>${escapeHtml(title)}</h1>
    <div class="meta">
      生成时间 ${escapeHtml(generatedAt)}
      ${args.target ? `· target <code>${escapeHtml(args.target)}</code>` : ""}
      ${args.judge ? `· judge <code>${escapeHtml(args.judge)}</code>` : ""}
    </div>
    <div class="totals">
      <div class="stat"><span class="label">Skills</span><span class="value">${skills.length}</span></div>
      <div class="stat"><span class="label">Evals</span><span class="value">${totalEvals}</span></div>
      <div class="stat ok"><span class="label">通过</span><span class="value">${totalPassed}</span></div>
      <div class="stat ${totalFailed > 0 ? "bad" : ""}"><span class="label">失败</span><span class="value">${totalFailed}</span></div>
      <div class="stat ${rateClass(overallRate)}"><span class="label">通过率</span><span class="value">${pct(overallRate)}</span></div>
    </div>
  </header>
  <main>${body}</main>
</body>
</html>`;

  mkdirSync(outputDir, { recursive: true });
  const reportPath = path.join(outputDir, "index.html");
  writeFileSync(reportPath, html, "utf-8");

  return { reportPath, summaryPath, skills: skills.length, evals: totalEvals };
}
