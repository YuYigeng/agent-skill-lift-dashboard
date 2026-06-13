# Attribution

This repository is a derivative portfolio project based on:

- Upstream: https://github.com/darkrishabh/agent-skills-eval
- Original license: MIT License
- Original author: Rishabh Mehan and agent-skills-eval contributors

The upstream CLI, SDK, baseline comparison flow, and artifact layout remain
credited to the original project. This derivative adds a product-facing lift
dashboard layer:

- `--product-report` CLI flag
- optional `--compare-workspace` run-over-run comparison
- `report/summary.json` for automation and portfolio screenshots
- eval metadata fields for `tags` and `risk`
- product scorecards for pass-rate lift, regressions, latency/token deltas, and
  failed assertions

The original `LICENSE` file is preserved.

