import { motion } from 'framer-motion'

const money = value => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(Math.round(value))

function signedMoney(value) {
  if (Math.abs(value) < 0.5) return '基准'
  return `${value > 0 ? '+' : '−'}¥${money(Math.abs(value))}`
}

export default function ScenarioLab({
  scenarios,
  activeScenarioId,
  onSelectScenario,
  demand,
  presets,
  horizonMonths,
  needResult,
  onPresetChange,
  onDemandNameChange,
  onDemandAmountChange,
  onDemandMonthChange,
  onToggleDemand,
  reducedMotion,
}) {
  return (
    <section data-ui="wallet" aria-labelledby="scenario-lab-title" className="mt-8 border-y border-white/[0.1] py-6 sm:py-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="mb-2 flex items-center gap-3 text-xs text-cyan">
            <span className="h-px w-7 bg-cyan/60" />把生活变化放进同一条曲线
          </div>
          <h3 id="scenario-lab-title" className="font-display text-xl font-medium tracking-[-.035em] text-copy sm:text-2xl">多情景与需求模拟</h3>
          <p className="mt-2 max-w-2xl text-xs leading-5 text-muted">对照求职、支出和收入变化，再试算一笔未来目标支出。以下均为可调整的情景假设，不是预测。</p>
        </div>
        <span className="text-[11px] text-faint">按月现金流 · 即时重算</span>
      </div>

      <div className="mt-6 grid gap-7 xl:grid-cols-[1.05fr_.95fr] xl:gap-10">
        <div className="min-w-0">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h4 className="text-sm font-medium text-copy">现金流路径</h4>
            <span className="text-[11px] text-muted">点击切换主曲线</span>
          </div>
          <div className="divide-y divide-white/[0.08] border-y border-white/[0.1]">
            {scenarios.map((scenario, index) => {
              const selected = scenario.id === activeScenarioId
              return (
                <motion.button
                  key={scenario.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onSelectScenario(scenario.id)}
                  whileTap={reducedMotion ? undefined : { scale: 0.995 }}
                  className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-l-2 px-3 py-3 text-left transition-colors sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:gap-x-6 ${selected ? 'border-cyan bg-cyan/[0.045]' : 'border-transparent hover:bg-white/[0.025]'}`}
                >
                  <span className="min-w-0">
                    <span className={`block truncate text-sm ${selected ? 'font-medium text-copy' : 'text-copy'}`}>{scenario.label}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-muted">{scenario.adjustment}</span>
                  </span>
                  <span className="row-span-2 text-right font-mono text-sm tabular-nums text-copy sm:row-span-1">¥{money(scenario.endingBalance)}</span>
                  <span className={`col-start-1 text-[11px] sm:col-start-auto sm:text-right ${scenario.delta < 0 ? 'text-[#e89a91]' : scenario.delta > 0 ? 'text-cyan' : 'text-faint'}`}>
                    {index === 0 ? '期末资产 · 基准' : `相对基准 ${signedMoney(scenario.delta)}`}
                  </span>
                </motion.button>
              )
            })}
          </div>
          <p className="mt-2 text-[11px] leading-5 text-faint">求职期延长、居住支出上浮、入职收入回落用于压力测试；主曲线和每项余额均按同一收益率假设计算。</p>
        </div>

        <div className="min-w-0 xl:border-l xl:border-white/[0.1] xl:pl-7">
          <div className="mb-3 flex items-start justify-between gap-4">
            <div>
              <h4 className="text-sm font-medium text-copy">未来需求资金</h4>
              <p className="mt-1 text-[11px] leading-5 text-muted">设置用途、金额和发生月份，查看当时余额能否覆盖。</p>
            </div>
            <span className="shrink-0 font-mono text-[10px] text-faint">{demand.label}</span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block min-w-0">
              <span className="mb-1.5 block text-xs text-muted">需求类型</span>
              <select
                value={demand.preset}
                onChange={event => onPresetChange(event.target.value)}
                className="h-10 w-full border border-white/[0.12] bg-[#0a1118] px-3 text-sm text-copy outline-none transition-colors focus:border-cyan/55"
              >
                {presets.map(preset => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
              </select>
            </label>
            <label className="block min-w-0">
              <span className="mb-1.5 block text-xs text-muted">需求金额</span>
              <span className="flex h-10 items-center gap-2 border border-white/[0.12] px-3 focus-within:border-cyan/55">
                <span className="font-mono text-xs text-faint">¥</span>
                <input
                  type="number"
                  min="0"
                  max="500000"
                  step="500"
                  value={demand.amount}
                  onChange={event => onDemandAmountChange(Number(event.target.value) || 0)}
                  aria-label="未来需求金额"
                  className="w-full bg-transparent font-mono text-sm tabular-nums text-copy outline-none"
                />
              </span>
            </label>
            {demand.preset === 'custom' && (
              <label className="block min-w-0 sm:col-span-2">
                <span className="mb-1.5 block text-xs text-muted">需求名称</span>
                <input
                  type="text"
                  maxLength={24}
                  value={demand.label}
                  onChange={event => onDemandNameChange(event.target.value)}
                  aria-label="自定义需求名称"
                  className="h-10 w-full border border-white/[0.12] bg-transparent px-3 text-sm text-copy outline-none focus:border-cyan/55"
                />
              </label>
            )}
          </div>

          <div className="mt-4 rounded-xl border border-white/[0.09] bg-white/[0.02] px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="need-month" className="text-xs text-muted">预计发生时间</label>
              <span className="font-mono text-xs tabular-nums text-copy">第 {demand.month} 个月</span>
            </div>
            <input
              id="need-month"
              type="range"
              min="1"
              max={horizonMonths}
              step="1"
              value={Math.min(demand.month, horizonMonths)}
              onChange={event => onDemandMonthChange(Number(event.target.value))}
              className="mt-3 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-cyan"
            />
            <div className="mt-1 flex justify-between font-mono text-[10px] text-faint"><span>1个月</span><span>{horizonMonths}个月</span></div>
          </div>

          <div className="mt-4 grid grid-cols-2 divide-x divide-y divide-white/[0.08] border-y border-white/[0.08]">
            <div className="py-3 pr-4">
              <span className="block text-[11px] text-muted">需求发生前余额</span>
              <span className="mt-1 block font-mono text-sm tabular-nums text-copy">¥{money(needResult.beforeBalance)}</span>
            </div>
            <div className="py-3 pl-4">
              <span className="block text-[11px] text-muted">支出后余额 / 缺口</span>
              {needResult.afterBalance >= 0
                ? <span className="mt-1 block font-mono text-sm tabular-nums text-copy">¥{money(needResult.afterBalance)}</span>
                : <span className="mt-1 block font-mono text-sm tabular-nums text-[#e89a91]">缺口 ¥{money(Math.abs(needResult.afterBalance))}</span>}
            </div>
            <div className="py-3 pr-4">
              <span className="block text-[11px] text-muted">按期平均准备</span>
              <span className="mt-1 block font-mono text-sm tabular-nums text-copy">¥{money(needResult.monthlyReserve)} / 月</span>
            </div>
            <div className="py-3 pl-4">
              <span className="block text-[11px] text-muted">对期末余额的影响</span>
              <span className="mt-1 block font-mono text-sm tabular-nums text-copy">−¥{money(needResult.endingImpact)}</span>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <span className="max-w-[300px] text-[11px] leading-5 text-faint">按期平均准备仅作拆分参考；支出发生时间与金额均可调整。</span>
            <button
              type="button"
              aria-pressed={demand.enabled}
              onClick={onToggleDemand}
              className={`min-h-10 border px-3.5 py-2 text-xs transition-colors ${demand.enabled ? 'border-cyan/55 bg-cyan/[0.09] text-cyan' : 'border-white/15 text-copy hover:border-white/30'}`}
            >
              {demand.enabled ? '已计入主曲线' : '计入主曲线'}
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
