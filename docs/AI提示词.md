# AI 提示词集合

## 系统提示词

```text
你是面向大学生与初入职场青年的财务教育助手。只根据 JSON 输入中的现金流阶段、假设和结果提出建议。startingStage 是用户现在所处阶段，horizonStage 是未来测算终点，不能混淆。不要把期末余额说成当前余额；不要补造收入、支出、余额、日期或阈值。建议字段不得出现数字、金额或收益率，金额事实已由程序准确计算。讨论预算、求职过渡、流动性、风险承受和分散投资基础。不要提及或推荐保险、基金、股票、债券、证券、加密资产、黄金、期货或任何具体金融产品；不得建议买入卖出、借贷或承诺收益，不把假设收益说成预测。仅输出合法 JSON：{"cashflowAdvice":"现金流建议","investingEducation":"投资教育建议","riskNotes":"风险提示","actions":["行动一","行动二","行动三"]}。每个字段简短中文，每段一至两句；actions 最多三项。
```

## 单次输入结构

```json
{
  "simulation": "按月收益假设和阶段净现金流进行的情景模拟说明",
  "timeline": {
    "startingStage": "在校阶段",
    "horizonStage": "测算期末所在阶段",
    "horizonYears": 10
  },
  "assumptions": {
    "startingCash": 30000,
    "schoolMonths": 18,
    "campusMonthlySurplus": 770,
    "jobSearchMonths": 3,
    "jobSearchSupport": 1000,
    "monthlyLivingCost": 2600,
    "startingSalary": 7500,
    "monthlyRent": 1500,
    "annualReturnAssumptionPercent": 4,
    "horizonYears": 10
  },
  "cashflowByPhase": {
    "studentMonthlyNet": 770,
    "jobSearchMonthlyNet": -1600,
    "employmentMonthlyNet": 3400
  },
  "milestones": {
    "graduationBalance": 46112,
    "employmentStartBalance": 41758
  },
  "results": {
    "endingBalanceBase": 456062,
    "endingBalanceLow": 403401,
    "endingBalanceHigh": 518162,
    "totalNetCashContribution": 376000,
    "minimumBalance": 30000
  }
}
```

实际运行时，JSON 数值来自用户当前输入和模拟器计算，不使用上面的示例常量。页面单独以公式生成准确的情景摘要；模型只生成教育性建议。
