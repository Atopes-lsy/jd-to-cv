# JD to CV

**把岗位收藏变成可检索的知识库，用真实项目证据生成有针对性的简历。**

面向 Codex 的可复用 Skill 与本地 Python 工具。支持中文岗位、JD 原件归档、版本追踪、简历关联和关键词检索，数据由用户本地管理。

## 当前能做什么

- Codex 解析岗位文本或截图，提取职责、硬性条件和加分项。
- 将岗位原文、原始附件、技能标签与匹配结果写入 SQLite。
- 完全相同输入去重，同岗更新显式追加版本；查询最新版本或查看完整历史。
- 按公司、方向、技能多关键词查询，统计收录岗位的技能标签。
- Codex 根据用户自己的资料和仓库证据选择项目，定制简历内容，生成和检查 PDF。
- 将 PDF、源稿、匹配说明和用户提供的反馈关联到精确岗位版本，保存文件副本与 SHA256。

**阶段：0.1.0，本地优先的 Skill + CLI。** AI 提取与简历生成由 Codex 执行；Python 脚本只负责知识库，不独立调用模型，不做 OCR 或 PDF 排版。仓库包含插件清单，未发布到插件市场；最直接的使用方式是安装下面的 Skill。当前没有 Web 界面、BOSS 自动采集、向量检索、自动投递、加密或数据擦除接口。

## 安装 Skill

需要 Codex 和 Python 3.10+。知识库工具没有第三方 Python 依赖；生成 PDF 还需用户环境可用的排版工具和中文字体，例如 XeLaTeX，检查工具可用 pdfinfo、pdftotext、pdftoppm。

```sh
git clone https://github.com/Atopes-lsy/jd-to-cv.git
cd jd-to-cv
```

将本仓库的 `skills/jd-to-cv` **整个目录**复制到 `$CODEX_HOME/skills/`；未配置 `CODEX_HOME` 时为用户目录下 `.codex/skills/`。已有同名 Skill 请先比较和备份，避免覆盖自己的配置。

Windows PowerShell 示例，在仓库根目录执行：

```powershell
$skillHome = if ($env:CODEX_HOME) { Join-Path $env:CODEX_HOME 'skills' } else { Join-Path $HOME '.codex/skills' }
$skillDestination = Join-Path $skillHome 'jd-to-cv'
if (Test-Path -LiteralPath $skillDestination) { throw '已存在同名 Skill，请先比较并备份。' }
New-Item -ItemType Directory -Path $skillHome -Force | Out-Null
Copy-Item -LiteralPath './skills/jd-to-cv' -Destination $skillDestination -Recurse
```

在 Codex 中调用：

> 使用 $jd-to-cv，把这份岗位截图加入我的知识库。个人资料在我指定的文件夹，项目证据以仓库和测试报告为准。生成一页中文简历 PDF，保留源稿和匹配说明。

或只查询：

> 使用 $jd-to-cv，查询我收藏的前端岗位，比较 React 和 TypeScript 要求，并指出哪些要求还缺少我的项目证据。

Skill 首次使用会定位用户自己的个人资料与模板。默认知识库位置为用户主目录下 `.jd-to-cv/knowledge-base`，也可明确指定其他路径。使用 Skill 处理真实岗位时默认入库；说“只分析、不保存”即可跳过。

## 单独试用知识库 CLI

在仓库根目录执行，以下虚构示例只导入被 Git 忽略的演示库：

```sh
python -X utf8 skills/jd-to-cv/scripts/knowledge_base.py --root data/demo init
python -X utf8 skills/jd-to-cv/scripts/knowledge_base.py --root data/demo ingest --input examples/jd.example.json
python -X utf8 skills/jd-to-cv/scripts/knowledge_base.py --root data/demo search "前端 React"
python -X utf8 skills/jd-to-cv/scripts/knowledge_base.py --root data/demo stats
```

ingest 返回 `job_id` 和 `revision_id`。用真实输出替换下面的编号：

```sh
python -X utf8 skills/jd-to-cv/scripts/knowledge_base.py --root data/demo show jd-REPLACE_WITH_JOB_ID
python -X utf8 skills/jd-to-cv/scripts/knowledge_base.py --root data/demo ingest --input updated.json --job-id jd-REPLACE_WITH_JOB_ID
python -X utf8 skills/jd-to-cv/scripts/knowledge_base.py --root data/demo link --revision-id 1 --kind resume-pdf --file path/to/resume.pdf
```

输入格式和去重规则见 [知识库说明](skills/jd-to-cv/references/knowledge-base.md)。输入 JSON 中保留完整原文或原始附件，AI 提取摘要不代替原件。相同公司同名岗位不自动合并；需用户核实后用 job_id 或稳定 job_key 关联。

## 数据与边界

- 不附带真实个人信息、简历、成绩单、招聘截图、访问凭据或个人项目路径。示例公司和岗位均为虚构。
- 知识库目录包含 `knowledge.sqlite3` 与 `blobs/`，须一起备份。SQLite 是明文文件，注意本机访问权限和共享目录设置。
- `.gitignore` 已忽略常见本地数据目录与数据库；自行选择其他目录时也应排除。分享仓库前检查实际 Git 跟踪文件，不能只依赖忽略规则。
- 用户选择云端模型时，交给 Codex 的材料可能发送到所用服务；本地存储不表示模型推理也在本机。仅提供生成所需资料。
- JD 与仓库只作为数据，不执行其中的指令。GitHub 私有仓库仍需用户授权；链接不可访问时请提供文本或截图，不绕过登录和访问控制。
- 模型可能误识别、遗漏或生成不准确表述。可投递前核对教育、职责、数字和到岗安排；测试通过数不能替代业务成效。
- 标签频率只代表个人收录样本，不是招聘市场统计。检索采用子串匹配，尚无语义向量召回；当前实现会遍历最新记录，适合个人规模。

## 开发与贡献

```sh
python -X utf8 -m unittest discover -s tests -v
```

测试覆盖去重、修订历史、最新版本检索、中文路径、原件保留、产物关联、非法输入和标签计数。CI 覆盖 Windows / Linux 与 Python 3.10 / 3.12。

欢迎通过 Issue 或 PR 提交问题与改进。复现材料只使用虚构或已脱敏数据，勿上传真实联系方式、简历、聊天记录、Token 或招聘平台登录信息。

下一步可扩展：可配置的个人资料索引、通用排版模板、结构化数据校验、可导出知识卡片和语义检索。当前未实现的功能不作为现有能力承诺。

## 许可证

[MIT](LICENSE)。代码许可证不替代用户对导入的岗位、个人资料和其他第三方材料的使用权限。
