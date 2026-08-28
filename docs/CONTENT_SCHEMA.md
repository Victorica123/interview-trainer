# 题目数据规范

生成结果位于 `content/questions.json`，最外层包含版本、生成时间、研究快照、数量统计、`taxonomy` 分类目录和 `questions` 数组。

每道题的主要字段：

| 字段 | 含义 |
| --- | --- |
| `id` | 稳定 ID；后端以 `be-` 开头，Agent 以 `ai-` 开头 |
| `track` | `backend` 或 `agent` |
| `category` | 学习模块 |
| `topicGroup` | 模块内的二级知识组 |
| `concept` | 去重后的核心概念 |
| `angle` | `definition`、`mechanism`、`application`、`pitfall` 或 `comparison` |
| `title` | 可独立作答的题干 |
| `tier` | `core`、`high` 或 `extended` |
| `difficulty` | 1–5 的回答难度 |
| `importance` | 当前研究快照下的 0–98 可解释排序分 |
| `tags` | 检索标签 |
| `beginnerHint` | 不直接泄露答案的起步提示 |
| `quickAnswer` | 面向复习的精简答案 |
| `keyPoints` | 自评或 AI 点评使用的要点 |
| `answerFramework` | 针对当前题型的四步回答结构 |
| `detailedAnswer` | 定义、机制、项目、误区和对比选型五段式讲解 |
| `relatedKnowledge` | 可用于反查题库的相关知识点 |
| `learningSourceIds` | 官方或权威延伸学习来源，与高频证据分开 |
| `contentStatus` | `reviewed` 或 `outline` |
| `contentReview`（可选） | 仅 `reviewed` 题存在；含复核日期、说明和核查来源 ID |
| `evidence` | 来源等级、来源 ID、近期样本数、加权支持和最近观察时间 |
| `scoreBase`（可选） | AI 评分复核前的公式基线分；仅被 AI 调整过的题有此字段 |
| `scoreNote`（可选） | AI 调整理由（≤120 字）；与 `scoreBase` 同时出现 |
| `scoreSource`（可选） | `ai`；仅被 AI 调整过的题有此字段 |
| `learningHints`（可选） | 八股文网站对应章节数组：`{site, title, url}`；仅作学习辅助，不参与评分 |

进度只保存在浏览器 `localStorage` 的 `interviewTrainerProgressV1` 键中。每题可记录 `level`、`attempts`、`answer`、`note`、`favorite`、`inMistakeBook`、`mistakeCount`、`dueAt` 和 `updatedAt`。自定义题单保存在 `interviewTrainerSessionsV1`，每个题单同时保存筛选配置和固定题目 ID；导出格式当前为 version 3，仍兼容只含进度的 version 2。主题与阅读字号保存在 `interviewTrainerAppearanceV1`。

不要手工编辑 `content/questions.json`，因为再次运行生成脚本会覆盖它。应修改 `scripts/catalog-backend.mjs`、`scripts/catalog-agent.mjs`、`research/new-concepts.json` 或 `research/sources.json`，然后运行：

```bash
npm run check
```

更新题库写入三个附加文件，生成脚本会自动读取：`research/new-concepts.json`（新增概念，可含 `topicGroup` 和 `learningHints`）、`research/ai-scores.json`（AI 评分复核记录，以题目 ID 为键，含 `base`、`importance`、`note`；调整必须满足：整数、0–98、与公式基线差 ≤6）与 `research/learning-hints.json`（以概念名为键的八股文网站对应章节，随更新并入）。后端分类统一由 `scripts/taxonomy.mjs` 约束。动态概念只能追加在 `research/new-concepts.json` 末尾；修改展示分类不得重排内置或动态概念数组，否则会改变稳定题目 ID。

Java 后端主流目录覆盖由 `scripts/test-coverage.mjs` 回归。当前固定 12 个专题中的 123 个必备检查项，要求知识点存在、分类正确、五类问法齐全，并校验学习资料不会误入面经趋势。审计来源和范围见 [COVERAGE_AUDIT.md](COVERAGE_AUDIT.md)。

人工内容复核单独登记在 `research/content-reviews.json`。`reviewBatches` 声明每批 ID、日期与题数，`questions` 按稳定题目 ID 保存状态、日期、说明与核查来源。只有状态为 `reviewed`、ID 存在、日期合法且至少引用一个已登记来源的题，生成后才会得到 `contentStatus: reviewed` 和公开 `contentReview` 摘要；校验器还要求批次声明题数与实际登记数一致。概念优先级或题目分数不会自动产生“已复核”声明。

来源记录可额外包含：`position`、`candidateLevel`（`intern|campus|experienced|unknown`）、`collection`（采集方式、采集时间、平台、是否参与趋势）、`engagement`（只允许页面明确文本中的非负整数互动指标）和 `qualityWarnings`（字符串数组）。这些字段由校验器检查；`GET /api/sources` 使用公开字段白名单，不会透传来源对象上的任意本地字段。
