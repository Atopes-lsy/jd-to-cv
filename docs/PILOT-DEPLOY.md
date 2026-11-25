# 内测部署与数据边界

## 当前形态

- `webapp/public`：电脑、手机共用的无框架界面。
- `webapp/worker`：Cloudflare Worker 后端，固定服务商地址、同源校验、按操作构造模型请求。
- `webapp/drizzle`：D1 只存预算、经同意的每日事件汇总和主动反馈，不存个人资料、岗位原图或密钥。
- `desktop/server.py`：标准库实现的回环后端；桌面启动器打开本机浏览器，同一套前端。桌面版的运营记录不自动上传。

使用 Sites 先创建并保留站点 ID 到 `webapp/.openai/hosting.json`，按 Sites 源码打包流程构建 `dist/server/index.js`。清单中的 `d1: "DB"` 由宿主绑定，发布时应用 schema-only Drizzle SQL。不要在请求中创建/迁移表。未部署时手机不能通过电脑的 `127.0.0.1` 访问；二维码必须编码已验证的公开 HTTPS 地址。

生产只在运行时设置 `DEEPSEEK_API_KEY`，不写入源码、静态资源、GitHub、Docker 镜像或客户端。此原型暂不接入任何第三方统计脚本。服务器代码不主动记录请求正文、Key 或客户端 IP；宿主和模型商仍会处理网络与服务所需的数据。

## 平台费用

当前用户批准上限为每天 ¥5。固定 `deepseek-flash`、关闭思考模式、不使用搜索等额外计费工具、输出最多 4096 Token、文字与提示合计最多 50000 UTF-8 字节、每次最多一张受限图片。调用前执行原子的预算 UPDATE，每北京时间日最多 20 次，每次预留 ¥0.25；超额返回 429，失败请求也保留预留，不自动重试。

定价检查日期：2026-11-25。依据 [DeepSeek 中文官方价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)，当日高峰非缓存输入 ¥2/百万 Token、输出 ¥8/百万 Token。[视觉文档](https://api-docs.deepseek.com/guides/vision/) 说明当前每图最多 1024 Token。按当前输入输出边界保守预留，实际费用通常低于预留。价格、模型规则或费率变动后须重新核验；本应用不能约束同一 Key 在其他产品中的使用或供应商记账时点。建议内测使用专用 Key，并检查供应商账单。

该策略偏保守：首次使用若识别个人资料图、识别 JD、再生成简历，需要三次预留。日总额不足时可自填 Key 或次日再试。尚无登录，无法保证匿名用户不能重复访问；全局预算会阻止突破应用配额，但不能阻止有人恶意耗尽当天的试用名额。扩大流量前可另行评估挑战验证和更精确的费用结算。

## 匿名统计与反馈

统计仅在用户主动勾选后发送，接收字段只允许 `{event,consent:true}`。白名单事件为岗位识别、资料图片识别、简历生成、打开打印、导出源稿；只按日期、事件累加，无用户标识、会话标识、资料或正文列。此计数不能当作独立用户数。

反馈只允许 `{rating,text,consent:true}`，评分 1–5，文字最多 1000 字；单独授权，界面提示不要填写个人信息或密钥。主动自由文本仍可能被用户填入敏感信息，维护者须限制数据库访问。反馈不与岗位库关联。反馈保留期限和具体运营审核流程尚待维护者在公开发布前确定；本原型未实现自动到期删除。

维护者通过宿主的数据库管理功能读取以下表，应用不提供公开的统计或反馈查询接口：

```sql
SELECT day, units, units * 0.25 AS reserved_yuan FROM daily_budget ORDER BY day DESC;
SELECT day, event, count FROM analytics ORDER BY day DESC;
SELECT day, rating, text FROM feedback ORDER BY id DESC;
```

浏览器岗位库上限 20 MB、100 个岗位；新增单岗版本上限 100，允许导入最多 2000 个旧版本，防止旧备份被截断。指纹为 SHA-256，不复制图片原文。备份采用紧凑 JSON、导入上限 30 MB；完整应用生成的备份在该范围内。达到容量时提示先导出，再由用户明确移除岗位。无需自动删除旧数据。

## 验证与发布

使用 `python scripts/preview_fixture.py` 启动合成预览，不会读取真实 Key，也不会调用模型。`scripts/qa-browser*.js` 通过 Playwright CLI 执行，测试材料是虚构信息。正式模式由 `python -m desktop.server` 启动。

验收后再部署、设为公开并生成二维码；先验证 `/api/config` 不暴露 Key、D1 表可用、预算确实停止、完整截图和 PDF 路径可用。回滚保留旧版本；本次仅新增三个运营表，不替换已有 CLI 数据库，也不回填个人资料。实际手机、微信内浏览器、未签名 Windows 包和模型生成的事实准确性需要人工验收。
