# 知识库操作

本库通过 Python 标准库提供 SQLite 存储和原件归档，无网络或模型调用。Codex 负责理解、提取和匹配；脚本负责存储。首次选择数据目录后持续复用，不按每次工作目录另建库。

以下 `SCRIPT` 为本 Skill 下 `scripts/knowledge_base.py` 的绝对路径，`KB` 为用户自己的知识库目录。路径作为独立参数传递，正确处理中文和空格。

```text
python -X utf8 SCRIPT --root KB init
python -X utf8 SCRIPT --root KB ingest --input record.json
python -X utf8 SCRIPT --root KB search "前端 React" --limit 50
python -X utf8 SCRIPT --root KB ingest --input updated.json --job-id jd-已有编号
python -X utf8 SCRIPT --root KB show jd-已有编号
python -X utf8 SCRIPT --root KB link --revision-id 1 --kind resume-pdf --file 简历.pdf
python -X utf8 SCRIPT --root KB stats
```

## 入库格式

输入为 UTF-8 JSON 对象，字段如下：

| 字段 | 类型 | 含义 |
|---|---|---|
| company / title / location / source_url | 字符串 | 岗位原始信息，未知留空 |
| direction | 字符串 | 分析归类，如前端、产品、数据分析 |
| raw_text | 字符串 | 完整原文或截图转写，不以摘要代替 |
| attachments | 字符串数组 | 原始截图/文件；相对路径相对输入 JSON |
| tags | 字符串数组 | 规范技能标签，如 React、TypeScript |
| requirements | 数组 | 对象含 text、type（hard/preferred/responsibility）、source_quote |
| matches | 数组 | 对象含 requirement、evidence（个人证据路径及章节）、status |
| gaps | 数组 | 尚缺证据或不满足的条件 |
| extraction_note | 字符串 | 提取疑点和分析限制 |
| job_key | 可选非空字符串 | 经人工确认的稳定岗位标识，不能用未经核实的分享链接 |

至少提供非空 raw_text 或一个附件。未知字段可用于附加信息，但 job_id、revision_id、captured_at、originals、artifacts 是系统保留字段，不得作为输入。

完全相同输入去重。同岗内容或分析变化时，检索确认后使用 `--job-id` 或稳定 `job_key` 追加版本；默认不按公司/标题模糊合并。`search` 是忽略大小写的多关键词子串 AND 查询，只检索每岗位最新版本；`show` 保留全部版本。同义词需分别检索，跨岗位分析提高 limit 并检查覆盖范围。

`stats` 统计最新版本的 tags，每岗位同一标签只计一次，不能代表整个招聘市场。规范同义标签后再比较。

附件与产物复制到 `blobs/`，记录 SHA256，源文件移动不影响归档。`link` 的 kind 支持 resume-pdf、resume-source、match-report、feedback；必须使用精确 revision_id。反馈只记录用户提供的内容，不自动推测投递状态。

数据库 `knowledge.sqlite3` 和 `blobs/` 要一起备份。不要将数据目录加入公开 Git 仓库，Git 忽略规则不能代替发布前检查。历史 JD 批量导入需用户明确范围，不能自动扫描私人目录。SQLite 内仍可能保留历史原文；本版本不提供彻底擦除或加密功能。
