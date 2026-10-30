# 千程智财｜青年财富旅程

面向大学生与初入职场青年的现金流情景模拟。把在校积累、毕业求职过渡、入职后收支放进一条资金曲线，再由本机 Qwen 生成简短的财务教育分析。

本项目独立于旧版 `e-bank-qiancheng`，沿用青年阶段现金流、毕业过渡和情景曲线这些已有内容，不复用旧站的部署或代码仓库。

## 本地运行

需要 Node.js 20.19+ 或 22.12+。

```bash
npm install
npm run dev
```

打开 Vite 输出的本地地址。生产构建：

```bash
npm run build
npm run preview
```

## 功能

- 编辑起始资产、在校月结余、毕业求职时长、过渡期支持、税后月薪、房租和生活费。
- 查看在校、毕业过渡、职场起步、长期目标四阶段资金曲线。
- 用年化收益假设的上下情景做敏感性对照；它不是概率区间或市场预测。
- 生成并下载青年现金流与投资教育报告。
- 不连接银行账户，不要求用户填写真实账号或 API Key。

## AI 使用

网页通过 Transformers.js 在支持 WebGPU 的浏览器里本机运行 `onnx-community/Qwen3.5-0.8B-ONNX-OPT`。首次生成报告时，浏览器会从 Hugging Face 下载模型文件（约 685 MB，另有少量配置文件）；网络可用后，浏览器缓存模型文件。页面从 CDN 加载 Transformers.js，并对大模型文件使用分段下载与断点重试。

不需要自建 API 服务，也不需要把 API Key 放进网页。用户输入与模拟结果在浏览器本机传给模型，不发送到推理服务。当前情景摘要由模拟器公式核算，Qwen 生成现金流建议、投资教育和风险提示；系统会拦截模型生成的未提供数字、具体产品词和阶段混淆，并以通用安全建议替换。

打开 AI 报告需要 HTTPS 或 localhost，以及提供 WebGPU 的新版 Chrome/Edge。首次下载较大，网络受限或设备不支持 WebGPU 时，AI 报告无法生成；曲线模拟仍可用。

技术材料见 [AI 技术说明](docs/AI技术说明.md) 和 [提示词集合](docs/AI提示词.md)。模型仓库：[Hugging Face · Qwen3.5-0.8B-ONNX-OPT](https://huggingface.co/onnx-community/Qwen3.5-0.8B-ONNX-OPT)。

## 部署

`.github/workflows/pages.yml` 可构建并发布 GitHub Pages。构建使用相对资源路径，适用于项目子路径。首次部署前，在仓库 **Settings → Pages → Build and deployment → Source** 中选择 **GitHub Actions**。

## 使用边界

页面仅用于学习和情景比较。收益率、收入、支出均为用户假设；未计入通胀、税费、突发支出与真实市场波动。AI 内容不是个性化投资建议，不推荐具体金融产品，也不保证收益。
