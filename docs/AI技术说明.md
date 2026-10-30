# AI 技术说明

## 模型与运行方式

- 模型：`onnx-community/Qwen3.5-0.8B-ONNX-OPT`
- 运行库：`@huggingface/transformers@4.3.0`（通过 jsDelivr 动态加载）
- 推理：Transformers.js + ONNX Runtime WebGPU，在访问者浏览器本机执行
- 模型精度：`embed_tokens: q4`、`vision_encoder: q4`、`decoder_model_merged: q4f16`
- 账号与服务：不调用云端推理 API，不需要用户 API Key；模型文件由 Hugging Face 提供
- 隐私：输入参数、模拟结果和提示词只在浏览器运行时传给本机模型，不发送到模型推理服务

模型卡提供的 ONNX 权重和配置来自公开仓库。首次使用需下载模型文件；浏览器缓存文件后可减少重复下载。页面将大文件拆为 8 MiB Range 请求，并在网络中断时续传，避免单个大响应被截断。

## 输入数据

项目没有接入银行、征信、投资账户或外部个人数据集。模型只读取用户当前页面填写的情景参数：

| 字段 | 含义 |
|---|---|
| `startingCash` | 当前起始资产 |
| `schoolMonths`、`campusMonthlySurplus` | 在校阶段时长与月净结余 |
| `jobSearchMonths`、`jobSearchSupport` | 求职过渡时长与月均家庭支持 |
| `monthlyLivingCost` | 月均生活支出 |
| `startingSalary`、`monthlyRent` | 入职后税后月薪与月均房租 |
| `annualReturnAssumptionPercent`、`horizonYears` | 年化收益假设与测算年限 |
| `selectedScenario`、`scenarioComparison` | 当前选中情景及四种现金流情景的期末余额对照 |
| `needSimulation` | 目标名称、金额、发生月份、支出前后余额、缺口及是否计入主曲线 |
| `cashflowByPhase` | 模拟器按上述参数计算的三阶段月净现金流 |
| `milestones`、`results` | 模拟器计算的毕业节点、入职节点、期末余额和敏感性情景 |

模拟器逐月按年化假设折算非负余额，再计入该月净现金流；负余额只记录未覆盖资金缺口，不按收益率滚动。启用目标支出后，模拟器在指定月份扣除一次性支出。AI 不计算终值；页面摘要和图表使用同一套确定性公式。低/高情景为基准收益率上下各 2.5 个百分点，不代表概率或预测。

## 报告流程

1. 用户点击“生成财务分析”。
2. 页面检查安全上下文和 WebGPU，再按需下载并加载 Qwen。
3. 程序把模拟输入、所选压力情景、四项期末对照、目标支出和节点结果交给浏览器本机模型。
4. Qwen 输出现金流建议、投资教育、风险提示和行动项。
5. 程序校验 JSON，过滤没有输入依据的数值、具体金融产品建议和把未来阶段误写成当前阶段的表述；不合规文本使用固定教育性建议替换。
6. 页面生成 Markdown 下载文件。

情景观察中的金额由模拟器公式生成，不是模型自由编写的数字。报告会标注模型、生成时间与用途边界。

## 提示词

完整系统提示词与输入结构见 [AI提示词.md](AI提示词.md)。

## 复现要求

- Node.js 20.19+ 或 22.12+
- `npm install` 后运行 `npm run dev`
- 使用 HTTPS 或 localhost
- 访问者的浏览器支持 WebGPU，且网络可下载 Transformers.js 与公开模型文件

GitHub Pages 只能托管静态前端；模型仍由访问者浏览器下载并运行。首次下载耗时取决于网络，WebGPU 不可用时 AI 报告不可用，现金流曲线仍可使用。
