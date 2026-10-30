import { useEffect, useMemo, useRef, useState } from 'react'
import WealthHero from './WealthHero'
import ScenarioLab from './ScenarioLab'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleHelp,
  Copy,
  Orbit,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  TrendingUp,
} from 'lucide-react'

const INITIAL = { principal: 30000, monthly: 770, years: 10, annualRate: 4, schoolMonths: 18, searchMonths: 3, graduateSupport: 1000, salary: 7500, rent: 1500, living: 2600 }
const YEAR_OPTIONS = [5, 10, 15, 20]
const INITIAL_NEED = { preset: 'moving', label: '毕业搬迁', amount: 8000, month: 18, enabled: false }
const NEED_PRESETS = [
  { id: 'moving', label: '毕业搬迁', amount: 8000 },
  { id: 'equipment', label: '学习设备', amount: 6000 },
  { id: 'emergency', label: '突发支出', amount: 10000 },
  { id: 'custom', label: '自定义', amount: 5000 },
]
const SCENARIO_DEFINITIONS = [
  { id: 'base', label: '当前规划', adjustment: '按现有输入测算', derive: values => values },
  { id: 'long-search', label: '求职延长', adjustment: '求职期增加 3 个月', derive: values => ({ ...values, searchMonths: Math.min(60, values.searchMonths + 3) }) },
  { id: 'higher-cost', label: '生活成本上浮', adjustment: '毕业后房租与生活费 +10%', derive: values => ({ ...values, rent: Math.round(values.rent * 1.1), living: Math.round(values.living * 1.1) }) },
  { id: 'lower-income', label: '收入低于预期', adjustment: '毕业后月薪 −10%', derive: values => ({ ...values, salary: Math.round(values.salary * 0.9) }) },
]
const MONTHS_PER_YEAR = 12
const HF_RANGE_BYTES = 8 * 1024 * 1024
const HF_RANGE_IDLE_TIMEOUT_MS = 60_000
let qwenRuntimePromise

function installHuggingFaceRangeFetch() {
  if (window.__qianchengRangeFetchInstalled) return
  const nativeFetch = window.fetch.bind(window)
  window.fetch = async (input, init = {}) => {
    const request = input instanceof Request ? input : null
    const url = request?.url ?? String(input)
    const method = (init.method ?? request?.method ?? 'GET').toUpperCase()
    const requestHeaders = new Headers(request?.headers)
    new Headers(init.headers).forEach((value, key) => requestHeaders.set(key, value))
    if (!url.startsWith('https://huggingface.co/') || method !== 'GET' || requestHeaders.has('range')) return nativeFetch(input, init)

    const original = await nativeFetch(input, init)
    const totalBytes = Number(original.headers.get('content-length'))
    if (!original.ok || !original.body || !Number.isFinite(totalBytes) || totalBytes <= HF_RANGE_BYTES) return original
    await original.body.cancel().catch(() => {})

    const baseInit = request ? {
      method: request.method, credentials: request.credentials, mode: request.mode, cache: request.cache,
      redirect: request.redirect, referrer: request.referrer, referrerPolicy: request.referrerPolicy,
      integrity: request.integrity, keepalive: request.keepalive, signal: init.signal ?? request.signal,
      ...init,
    } : { ...init }
    let cursor = 0
    let segmentStart = 0
    let segmentEnd = 0
    let segmentBytes = 0
    let retries = 0
    let reader = null
    let cancelled = false

    const openSegment = async () => {
      segmentStart = cursor
      segmentEnd = Math.min(segmentStart + HF_RANGE_BYTES - 1, totalBytes - 1)
      segmentBytes = 0
      const headers = new Headers(requestHeaders)
      headers.set('Range', `bytes=${segmentStart}-${segmentEnd}`)
      let part
      const timeoutController = new AbortController()
      const timeoutId = setTimeout(() => timeoutController.abort(new Error('模型分段请求超时')), HF_RANGE_IDLE_TIMEOUT_MS)
      try {
        const signal = baseInit.signal
          ? AbortSignal.any([baseInit.signal, timeoutController.signal])
          : timeoutController.signal
        part = await nativeFetch(url, { ...baseInit, method: 'GET', headers, signal })
      } catch (error) {
        console.warn(`[Qwen3.5] Range ${segmentStart}-${segmentEnd} failed`, error)
        throw error
      } finally {
        clearTimeout(timeoutId)
      }
      console.info(`[Qwen3.5] Range ${segmentStart}-${segmentEnd}: HTTP ${part.status}`)
      if (part.status !== 206 || !part.body) {
        await part.body?.cancel().catch(() => {})
        throw new Error(`Hugging Face 分段下载失败：HTTP ${part.status}`)
      }
      reader = part.body.getReader()
    }

    const body = new ReadableStream({
      async pull(controller) {
        if (cancelled) return
        try {
          if (!reader) {
            if (cursor >= totalBytes) {
              controller.close()
              return
            }
            await openSegment()
          }
          let readTimeoutId
          let chunk
          try {
            chunk = await Promise.race([
              reader.read(),
              new Promise((_, reject) => {
                readTimeoutId = setTimeout(() => reject(new Error('模型分段读取超时')), HF_RANGE_IDLE_TIMEOUT_MS)
              }),
            ])
          } finally {
            clearTimeout(readTimeoutId)
          }
          const { value, done } = chunk
          if (!done) {
            segmentBytes += value.byteLength
            controller.enqueue(value)
            return
          }
          reader = null
          if (segmentBytes !== segmentEnd - segmentStart + 1) {
            cursor = segmentStart + segmentBytes
            if (retries++ >= 3) throw new Error('模型分段下载连续中断，请检查网络后重试。')
            return
          }
          cursor = segmentEnd + 1
          retries = 0
        } catch (error) {
          console.warn(`[Qwen3.5] Stream at ${segmentStart + segmentBytes}/${totalBytes} failed`, error)
          try { await reader?.cancel() } catch {}
          reader = null
          cursor = segmentStart + segmentBytes
          if (retries++ >= 3) {
            controller.error(error)
            return
          }
        }
      },
      async cancel(reason) {
        cancelled = true
        await reader?.cancel(reason)
      },
    })
    const headers = new Headers(original.headers)
    headers.set('Content-Length', String(totalBytes))
    return new Response(body, { status: original.status, statusText: original.statusText, headers })
  }
  window.__qianchengRangeFetchInstalled = true
}

async function loadQwenRuntime(onProgress) {
  if (!qwenRuntimePromise) {
    qwenRuntimePromise = (async () => {
      installHuggingFaceRangeFetch()
      const { AutoProcessor, Qwen3_5ForConditionalGeneration } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0')
      const modelId = 'onnx-community/Qwen3.5-0.8B-ONNX-OPT'
      const processor = await AutoProcessor.from_pretrained(modelId, { progress_callback: onProgress })
      const model = await Qwen3_5ForConditionalGeneration.from_pretrained(modelId, { dtype: { embed_tokens: 'q4', vision_encoder: 'q4', decoder_model_merged: 'q4f16' }, device: 'webgpu', progress_callback: onProgress })
      return { processor, model }
    })().catch(error => { qwenRuntimePromise = null; throw error })
  }
  return qwenRuntimePromise
}

function futureValue(principal, monthly, months, annualRate) {
  const monthlyRate = annualRate / 100 / MONTHS_PER_YEAR
  if (Math.abs(monthlyRate) < 0.000001) return principal + monthly * months
  const growth = (1 + monthlyRate) ** months
  return principal * growth + monthly * ((growth - 1) / monthlyRate)
}

function formatMoney(value) {
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(Math.round(value))
}

function formatCompact(value) {
  if (value >= 100000000) return `${(value / 100000000).toFixed(2)} 亿`
  if (value >= 10000) return `${(value / 10000).toFixed(value >= 1000000 ? 0 : 1)} 万`
  return formatMoney(value)
}

function monthlyFlow(values, month) {
  if (month <= values.schoolMonths) return values.monthly
  if (month <= values.schoolMonths + values.searchMonths) return values.graduateSupport - values.living
  return values.salary - values.rent - values.living
}

function rollBalance(balance, annualRate, flow) {
  const interestBearingBalance = Math.max(0, balance)
  const uncoveredGap = Math.min(0, balance)
  return interestBearingBalance * (1 + annualRate / 1200) + uncoveredGap + flow
}

function makeProjection(values, demand) {
  const months = values.years * MONTHS_PER_YEAR
  const delta = 2.5
  const lowRate = Math.max(-1.5, values.annualRate - delta)
  const highRate = values.annualRate + delta
  const balances = { low: values.principal, base: values.principal, high: values.principal }
  let invested = values.principal
  const points = [{ month: 0, low: balances.low, base: balances.base, high: balances.high }]
  for (let month = 1; month <= months; month += 1) {
    const flow = monthlyFlow(values, month)
    invested += flow
    balances.low = rollBalance(balances.low, lowRate, flow)
    balances.base = rollBalance(balances.base, values.annualRate, flow)
    balances.high = rollBalance(balances.high, highRate, flow)
    if (demand?.enabled && month === demand.month) {
      invested -= demand.amount
      balances.low -= demand.amount
      balances.base -= demand.amount
      balances.high -= demand.amount
    }
    points.push({ month, low: balances.low, base: balances.base, high: balances.high })
  }
  return {
    points,
    lowRate,
    highRate,
    invested,
    low: points.at(-1).low,
    base: points.at(-1).base,
    high: points.at(-1).high,
  }
}

function balanceAtMonth(values, targetMonth, demand) {
  const monthLimit = Math.min(targetMonth, values.years * MONTHS_PER_YEAR)
  let balance = values.principal
  for (let month = 1; month <= monthLimit; month += 1) {
    balance = rollBalance(balance, values.annualRate, monthlyFlow(values, month))
    if (demand?.enabled && month === demand.month) balance -= demand.amount
  }
  return balance
}

function containsUnsupportedAdviceNumber(text) {
  return /[0-9０-９¥￥%％]|[一二三四五六七八九十百千万亿零两]+\s*(?:元|万元|块|个月|月|年|天|%|％)/.test(text)
}

function isSafeAdviceText(text) {
  const unsafeProducts = /保险|基金|股票|债券|证券|加密货币|加密资产|期货|黄金|理财产品|教育基金|(?:购买|买入|卖出|定投|配置).{0,10}(?:资产|产品)/
  const wrongCurrentStage = /当前(?:现金流|余额|阶段).{0,10}(?:求职|就业|职场|毕业)|(?:当前|现在).{0,5}(?:处于|进入).{0,6}(?:求职|就业|职场)/
  return Boolean(text) && !containsUnsupportedAdviceNumber(text) && !unsafeProducts.test(text) && !wrongCurrentStage.test(text)
}

function chartGeometry(points) {
  const width = 1000
  const height = 430
  const pad = { top: 28, right: 34, bottom: 48, left: 76 }
  const plotW = width - pad.left - pad.right
  const plotH = height - pad.top - pad.bottom
  const min = Math.min(0, ...points.map((point) => point.low))
  const max = Math.max(1, ...points.map((point) => point.high)) * 1.08
  const domainMin = min < 0 ? min * 1.08 : 0
  const range = max - domainMin
  const x = (index) => pad.left + (index / (points.length - 1)) * plotW
  const y = (value) => pad.top + ((max - value) / range) * plotH
  const pathFor = (key) => points.map((point, index) => `${index ? 'L' : 'M'} ${x(index).toFixed(1)} ${y(point[key]).toFixed(1)}`).join(' ')
  const upper = points.map((point, index) => `${index ? 'L' : 'M'} ${x(index).toFixed(1)} ${y(point.high).toFixed(1)}`).join(' ')
  const lowerReverse = [...points].reverse().map((point, reverseIndex) => {
    const index = points.length - reverseIndex - 1
    return `L ${x(index).toFixed(1)} ${y(point.low).toFixed(1)}`
  }).join(' ')
  const area = `${upper} ${lowerReverse} Z`
  const ticks = Array.from({ length: 5 }, (_, index) => max - (range * index) / 4)
  return { width, height, pad, plotW, plotH, min: domainMin, max, range, ticks, zeroY: y(0), x, y, pathFor, area }
}

function AssetChart({ projection, years, reducedMotion, milestones, animationKey, demand }) {
  const [hoverIndex, setHoverIndex] = useState(null)
  const svgRef = useRef(null)
  const geometry = useMemo(() => chartGeometry(projection.points), [projection.points])
  const { points } = projection
  const selectedIndex = hoverIndex ?? points.length - 1
  const selected = points[selectedIndex]
  const yearMarks = [0, 1, 2, 3].map((slot) => Math.round((points.length - 1) * (slot / 3)))

  function trackPointer(event) {
    if (!svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
    const plotRatio = Math.min(1, Math.max(0, (ratio * geometry.width - geometry.pad.left) / geometry.plotW))
    setHoverIndex(Math.round(plotRatio * (points.length - 1)))
  }

  return (
    <div className="relative mt-5 min-w-0">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${geometry.width} ${geometry.height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${years}年资产情景曲线，终值基准约${formatMoney(projection.base)}元`}
        className="block h-[250px] w-full overflow-visible touch-pan-y sm:h-[320px] lg:h-[380px] xl:h-[420px]"
        onPointerMove={trackPointer}
        onPointerLeave={() => setHoverIndex(null)}
      >
        <defs>
          <linearGradient id="rangeFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7ce4e4" stopOpacity=".13" />
            <stop offset="100%" stopColor="#7ce4e4" stopOpacity=".015" />
          </linearGradient>
          <linearGradient id="lineFill" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#8cb9ff" />
            <stop offset="55%" stopColor="#7ce4e4" />
            <stop offset="100%" stopColor="#b1f5e4" />
          </linearGradient>
          <filter id="pointGlow" x="-300%" y="-300%" width="700%" height="700%">
            <feGaussianBlur stdDeviation="8" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {geometry.ticks.map((value, tick) => {
          const y = geometry.y(value)
          return (
            <g key={tick}>
              <line x1={geometry.pad.left} x2={geometry.width - geometry.pad.right} y1={y} y2={y} stroke="#93a9b7" strokeOpacity={Math.abs(value) < geometry.range * .005 ? '.24' : '.09'} strokeDasharray={Math.abs(value) < geometry.range * .005 ? '0' : '3 8'} />
              <text x="0" y={y + 4} fill="#738591" fontSize="13" fontFamily="DM Mono, monospace">{value === 0 ? '0' : formatCompact(value)}</text>
            </g>
          )
        })}
        <line x1={geometry.pad.left} x2={geometry.width - geometry.pad.right} y1={geometry.zeroY} y2={geometry.zeroY} stroke="#c7d7da" strokeOpacity=".2" />

        <motion.path
          key={`range-${animationKey}`}
          d={geometry.area}
          fill="url(#rangeFill)"
          initial={reducedMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: reducedMotion ? 0 : 1.1, ease: [0.16, 1, 0.3, 1] }}
        />

        {demand?.enabled && demand.month <= years * MONTHS_PER_YEAR && (() => {
          const index = demand.month
          const point = points[index]
          return <g aria-label={`${demand.label}支出，${demand.month}个月后，${formatMoney(demand.amount)}元`}><line x1={geometry.x(index)} x2={geometry.x(index)} y1={geometry.pad.top} y2={geometry.pad.top + geometry.plotH} stroke="#e8b68f" strokeOpacity=".52" strokeDasharray="4 5"/><circle cx={geometry.x(index)} cy={geometry.y(point.base)} r="7" fill="#e8b68f" fillOpacity=".9" stroke="#10171d" strokeWidth="3"/></g>
        })()}
        <motion.path key={`low-${animationKey}`} d={geometry.pathFor('low')} fill="none" stroke="#8096a3" strokeOpacity=".32" strokeWidth="1.4" strokeDasharray="4 7" initial={reducedMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: reducedMotion ? 0 : 0.45, delay: reducedMotion ? 0 : 0.12 }} />
        <motion.path key={`high-${animationKey}`} d={geometry.pathFor('high')} fill="none" stroke="#8096a3" strokeOpacity=".32" strokeWidth="1.4" strokeDasharray="4 7" initial={reducedMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: reducedMotion ? 0 : 0.45, delay: reducedMotion ? 0 : 0.12 }} />
        <motion.path
          key={`base-${animationKey}`}
          d={geometry.pathFor('base')}
          fill="none"
          stroke="url(#lineFill)"
          strokeWidth="3.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={reducedMotion ? false : { pathLength: 0, opacity: 0.35 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: reducedMotion ? 0 : 1.35, ease: [0.16, 1, 0.3, 1] }}
        />

        {milestones.slice(1).map((milestone, index) => {
          const point = points[milestone.index]
          return (
            <motion.g
              key={`${animationKey}-${milestone.title}`}
              initial={reducedMotion ? false : { opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: reducedMotion ? 0 : 0.32, delay: reducedMotion ? 0 : 0.7 + index * 0.12 }}
            >
              <circle cx={geometry.x(milestone.index)} cy={geometry.y(point.base)} r="10" fill="#7ce4e4" fillOpacity=".11" />
              <circle cx={geometry.x(milestone.index)} cy={geometry.y(point.base)} r="3.5" fill="#d5fffa" stroke="#071216" strokeWidth="1.5" />
            </motion.g>
          )
        })}

        {yearMarks.map((index, slot) => {
          const point = points[index]
          return (
            <g key={`${index}-${slot}`}>
              <line x1={geometry.x(index)} x2={geometry.x(index)} y1={geometry.pad.top + geometry.plotH} y2={geometry.pad.top + geometry.plotH + 5} stroke="#71818b" strokeOpacity=".5" />
              <text x={geometry.x(index)} y={geometry.height - 11} fill="#738591" fontSize="13" textAnchor={slot === 0 ? 'start' : slot === 3 ? 'end' : 'middle'} fontFamily="DM Mono, monospace">
                {point.month === 0 ? '现在' : `${(point.month / 12).toFixed(point.month % 12 ? 1 : 0)}年`}
              </text>
            </g>
          )
        })}

        {hoverIndex !== null && (
          <g pointerEvents="none">
            <line x1={geometry.x(selectedIndex)} x2={geometry.x(selectedIndex)} y1={geometry.pad.top} y2={geometry.pad.top + geometry.plotH} stroke="#e4f4f2" strokeOpacity=".44" strokeDasharray="3 5" />
            <circle cx={geometry.x(selectedIndex)} cy={geometry.y(selected.base)} r="11" fill="#7ce4e4" fillOpacity=".16" filter="url(#pointGlow)" />
            <circle cx={geometry.x(selectedIndex)} cy={geometry.y(selected.base)} r="4.2" fill="#d5fffa" stroke="#071016" strokeWidth="2" />
          </g>
        )}
      </svg>
      <div className="mt-1 flex items-center justify-between border-t border-white/[0.07] pt-3 text-xs text-muted">
        <span>{hoverIndex === null ? '曲线终点' : `${(selected.month / 12).toFixed(selected.month % 12 ? 1 : 0)} 年后`}</span>
        <span className="font-mono text-sm tabular-nums text-copy">¥ {formatMoney(selected.base)}</span>
      </div>
    </div>
  )
}

function NumericField({ label, suffix, value, onChange, min, max, step = 1, prefix = '¥' }) {
  return (
    <label className="group block rounded-xl border border-white/[0.075] bg-white/[0.025] px-4 py-3 transition-colors focus-within:border-cyan/45 focus-within:bg-cyan/[0.035]">
      <span className="flex items-center justify-between text-xs text-muted">
        <span>{label}</span><span className="text-faint">{suffix}</span>
      </span>
      <span className="mt-2 flex items-center gap-2">
        <span className="font-mono text-xs text-faint">{prefix}</span>
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Math.min(max, Math.max(min, Number(event.target.value) || 0)))}
          className="w-full bg-transparent font-display text-lg tabular-nums text-copy outline-none placeholder:text-faint"
          aria-label={label}
        />
      </span>
    </label>
  )
}

function App() {
  const reducedMotion = useReducedMotion()
  const [values, setValues] = useState(INITIAL)
  const [activeScenarioId, setActiveScenarioId] = useState('base')
  const [demand, setDemand] = useState(INITIAL_NEED)
  const [chartRevision, setChartRevision] = useState(0)
  const [copied, setCopied] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiStatus, setAiStatus] = useState('尚未调用模型')
  const [aiReport, setAiReport] = useState(null)
  const chartRef = useRef(null)
  const aiInputRevision = useRef(0)
  const activeScenario = SCENARIO_DEFINITIONS.find(scenario => scenario.id === activeScenarioId) ?? SCENARIO_DEFINITIONS[0]
  const effectiveValues = useMemo(() => activeScenario.derive(values), [activeScenario, values])
  const effectiveDemand = useMemo(() => ({ ...demand, month: Math.min(demand.month, effectiveValues.years * MONTHS_PER_YEAR) }), [demand, effectiveValues.years])
  const projection = useMemo(() => makeProjection(effectiveValues, effectiveDemand), [effectiveValues, effectiveDemand])
  const scenarioRows = useMemo(() => {
    const baseProjection = makeProjection(values, effectiveDemand)
    return SCENARIO_DEFINITIONS.map(scenario => {
      const scenarioProjection = scenario.id === activeScenarioId ? projection : makeProjection(scenario.derive(values), effectiveDemand)
      return { ...scenario, endingBalance: scenarioProjection.base, delta: scenarioProjection.base - baseProjection.base }
    })
  }, [values, activeScenarioId, projection, effectiveDemand])
  const needResult = useMemo(() => {
    const noNeedProjection = makeProjection(effectiveValues, { ...effectiveDemand, enabled: false })
    const beforeBalance = balanceAtMonth(effectiveValues, effectiveDemand.month)
    return {
      beforeBalance,
      afterBalance: beforeBalance - effectiveDemand.amount,
      monthlyReserve: effectiveDemand.amount / Math.max(1, effectiveDemand.month),
      endingImpact: Math.max(0, noNeedProjection.base - makeProjection(effectiveValues, { ...effectiveDemand, enabled: true }).base),
    }
  }, [effectiveValues, effectiveDemand])
  const growth = Math.max(0, projection.base - projection.invested)
  const contributionShare = projection.base > 0 ? Math.min(100, (projection.invested / projection.base) * 100) : 0
  const milestones = useMemo(() => {
    const totalMonths = effectiveValues.years * MONTHS_PER_YEAR
    const transitionMonth = Math.min(24, Math.max(12, Math.round(totalMonths * 0.25)))
    const careerMonth = Math.min(totalMonths, Math.max(transitionMonth + 6, Math.min(48, Math.round(totalMonths * 0.45))))
    return [
      { month: 0, title: '在校起点', detail: '现在' },
      { month: transitionMonth, title: '毕业过渡', detail: `${(transitionMonth / 12).toFixed(1)} 年` },
      { month: careerMonth, title: '职场起步', detail: `${(careerMonth / 12).toFixed(1)} 年` },
      { month: totalMonths, title: '长期目标', detail: `${effectiveValues.years} 年` },
    ].map((milestone) => ({
      ...milestone,
      index: milestone.month,
    }))
  }, [effectiveValues.years, projection.points])

  const chartModelKey = JSON.stringify([effectiveValues, effectiveDemand.enabled, effectiveDemand.amount, effectiveDemand.month, activeScenarioId])
  const previousChartKey = useRef(chartModelKey)

  useEffect(() => {
    if (previousChartKey.current === chartModelKey) {
      return undefined
    }
    previousChartKey.current = chartModelKey
    const timer = window.setTimeout(() => setChartRevision((revision) => revision + 1), 220)
    return () => window.clearTimeout(timer)
  }, [chartModelKey])

  function invalidateReport() {
    aiInputRevision.current += 1
    if (aiReport) {
      setAiReport(null)
      setAiStatus('模拟参数已变，请重新生成匹配当前数据的报告。')
    } else if (aiBusy) {
      setAiStatus('模拟参数已变；当前分析完成后将丢弃旧结果。')
    }
  }

  function update(key, value) {
    setValues((current) => ({ ...current, [key]: value }))
    invalidateReport()
  }

  function selectScenario(id) {
    setActiveScenarioId(id)
    invalidateReport()
  }

  function updateDemand(patch) {
    setDemand(current => ({ ...current, ...patch }))
    invalidateReport()
  }

  async function generateAiReport() {
    if (aiBusy) return
    const revisionAtStart = aiInputRevision.current
    setAiBusy(true)
    setAiReport(null)
    setAiStatus('正在加载开源 Qwen3.5 模型…首次使用需下载模型权重。')
    let stage = '加载模型'
    try {
      if (!window.isSecureContext) throw new Error('本机模型需要 HTTPS 或 localhost。')
      if (!navigator.gpu) throw new Error('浏览器未提供 WebGPU。请用新版 Edge 或 Chrome 打开。')
      const progress = event => {
        if (event?.status === 'progress' && Number.isFinite(event.progress)) {
          const asset = event.file ? ` · ${String(event.file).split('/').at(-1)}` : ''
          setAiStatus(`首次下载模型文件 ${Math.round(event.progress)}%${asset}…`)
        } else if (event?.status === 'ready') {
          stage = '初始化本机 GPU'
          setAiStatus('模型已下载，正在初始化本机 GPU…')
        }
      }
      const { processor, model } = await loadQwenRuntime(progress)
      stage = '生成分析报告'
      const scenarioValues = effectiveValues
      const searchEndMonth = scenarioValues.schoolMonths + scenarioValues.searchMonths
      const endMonth = scenarioValues.years * MONTHS_PER_YEAR
      const studentNet = scenarioValues.monthly
      const searchNet = scenarioValues.graduateSupport - scenarioValues.living
      const employmentNet = scenarioValues.salary - scenarioValues.rent - scenarioValues.living
      const horizonStage = endMonth <= scenarioValues.schoolMonths ? '在校阶段' : endMonth <= searchEndMonth ? '求职过渡阶段' : '就业阶段'
      const milestoneSummary = [
        scenarioValues.schoolMonths <= endMonth ? `毕业节点约 ¥${formatMoney(balanceAtMonth(scenarioValues, scenarioValues.schoolMonths, effectiveDemand))}` : null,
        searchEndMonth <= endMonth ? `入职节点约 ¥${formatMoney(balanceAtMonth(scenarioValues, searchEndMonth, effectiveDemand))}` : null,
      ].filter(Boolean).join('；')
      const needSummary = `${effectiveDemand.label} ¥${formatMoney(effectiveDemand.amount)}，第 ${effectiveDemand.month} 个月发生；发生前约 ¥${formatMoney(needResult.beforeBalance)}，支出后约 ¥${formatMoney(needResult.afterBalance)}${effectiveDemand.enabled ? '，已计入主曲线' : '，主曲线暂未计入'}。`
      const scenarioSummary = scenarioRows.map(scenario => `${scenario.label} ¥${formatMoney(scenario.endingBalance)}`).join('；')
      const deterministicSummary = `当前情景为“${activeScenario.label}”（${activeScenario.adjustment}），时间轴结束于${horizonStage}。在校月净结余 ¥${formatMoney(studentNet)}，求职期月净现金流 ${searchNet < 0 ? '-' : ''}¥${formatMoney(Math.abs(searchNet))}，入职后月净结余 ¥${formatMoney(employmentNet)}。${milestoneSummary ? `${milestoneSummary}；` : ''}${needSummary}情景期末对照：${scenarioSummary}。${scenarioValues.years} 年期末约 ¥${formatMoney(projection.base)}，低/高收益假设对照约 ¥${formatMoney(projection.low)} / ¥${formatMoney(projection.high)}。以上由输入假设计算，不是收益预测。`
      const facts = {
        simulation: '每月仅对非负余额按假设年化收益折算，再计入当月净现金流；负余额按未覆盖缺口记录，不计收益。各阶段现金流均为用户输入情景，不是预测。',
        selectedScenario: { name: activeScenario.label, adjustment: activeScenario.adjustment },
        scenarioComparison: scenarioRows.map(scenario => ({ name: scenario.label, adjustment: scenario.adjustment, endingBalance: Math.round(scenario.endingBalance), deltaFromCurrentPlan: Math.round(scenario.delta) })),
        timeline: { startingStage: '在校阶段', horizonStage, horizonYears: scenarioValues.years },
        assumptions: { startingCash: scenarioValues.principal, schoolMonths: scenarioValues.schoolMonths, campusMonthlySurplus: scenarioValues.monthly, jobSearchMonths: scenarioValues.searchMonths, jobSearchSupport: scenarioValues.graduateSupport, monthlyLivingCost: scenarioValues.living, startingSalary: scenarioValues.salary, monthlyRent: scenarioValues.rent, annualReturnAssumptionPercent: scenarioValues.annualRate, horizonYears: scenarioValues.years },
        cashflowByPhase: { studentMonthlyNet: studentNet, jobSearchMonthlyNet: searchNet, employmentMonthlyNet: employmentNet },
        needSimulation: { name: effectiveDemand.label, amount: effectiveDemand.amount, month: effectiveDemand.month, includedInMainCurve: effectiveDemand.enabled, balanceBefore: Math.round(needResult.beforeBalance), balanceAfter: Math.round(needResult.afterBalance), fundingGap: Math.max(0, Math.round(-needResult.afterBalance)), endingBalanceImpact: Math.round(needResult.endingImpact) },
        results: { endingBalanceBase: Math.round(projection.base), endingBalanceLow: Math.round(projection.low), endingBalanceHigh: Math.round(projection.high), totalNetCashContribution: Math.round(projection.invested), minimumBalance: Math.round(Math.min(...projection.points.map(p => p.base))) },
      }
      setAiStatus('Qwen3.5 正在分析现金流与风险…')
      stage = '本机 WebGPU 推理'
      const messages = [
        { role: 'system', content: '你是面向大学生与初入职场青年的财务教育助手。只根据 JSON 输入中的现金流阶段、多情景比较、需求模拟和结果提出建议。startingStage 是用户现在所处阶段，horizonStage 是未来测算终点，不能混淆。不要把期末余额说成当前余额；不要补造收入、支出、余额、日期或阈值。建议字段不得出现数字、金额或收益率，金额事实已由程序准确计算。结合当前选中情景、情景差异与需求资金，讨论预算、求职过渡、流动性、风险承受和分散投资基础。不要提及或推荐保险、基金、股票、债券、证券、加密资产、黄金、期货或任何具体金融产品；不得建议买入卖出、借贷或承诺收益，不把假设收益说成预测。仅输出合法 JSON：{"cashflowAdvice":"现金流建议","investingEducation":"投资教育建议","riskNotes":"风险提示","actions":["行动一","行动二","行动三"]}。每个字段简短中文，每段一至两句；actions 最多三项。' },
        { role: 'user', content: JSON.stringify(facts) },
      ]
      const prompt = processor.apply_chat_template(messages, { add_generation_prompt: true, enable_thinking: false })
      const input = await processor(prompt)
      const output = await model.generate({ ...input, max_new_tokens: 420, do_sample: false })
      const raw = processor.batch_decode(output.slice(null, [input.input_ids.dims.at(-1), null]), { skip_special_tokens: true })[0]
      const json = raw.match(/\{[\s\S]*\}/)?.[0]
      if (!json) throw new Error('模型没有返回可读取的报告，请重试。')
      const generated = JSON.parse(json)
      if (!generated.cashflowAdvice || !generated.investingEducation || !generated.riskNotes || !Array.isArray(generated.actions)) throw new Error('模型报告格式不完整，请重试。')
      const fallbacks = {
        cashflowAdvice: '把在校、求职和就业阶段分开记账，先确认过渡期收入能否覆盖基本支出；现金流为负时，优先调整可变支出或增加储蓄准备。',
        investingEducation: '先理解风险承受、流动性、费用和分散原则，再学习不同资产类别的波动特征；不要把模拟收益当作确定收益。',
        riskNotes: '模拟未计入通胀、税费、突发支出与市场回撤；实际收益可能为负，应留意流动性和自身风险承受能力。',
      }
      const safeAdvice = Object.fromEntries(Object.entries(fallbacks).map(([key, fallback]) => {
        const text = String(generated[key] ?? '').trim()
        return [key, isSafeAdviceText(text) ? text : fallback]
      }))
      const fallbackActions = [
        '记录实际收支，定期更新在校、求职、就业三阶段的现金流。',
        '单独核算求职过渡期的资金需求，再规划长期投资额度。',
        '先学习风险、费用与分散原则，不借款投资，也不照搬他人组合。',
      ]
      const actions = [...new Set(generated.actions.slice(0, 3).map((item, index) => {
        const text = String(item ?? '').trim()
        return isSafeAdviceText(text) ? text : fallbackActions[index]
      }).filter(Boolean))]
      for (const action of fallbackActions) {
        if (actions.length >= 3) break
        if (!actions.includes(action)) actions.push(action)
      }
      if (revisionAtStart !== aiInputRevision.current) {
        setAiStatus('分析期间模拟参数已变，旧报告已丢弃；请重新生成。')
        return
      }
      setAiReport({ summary: deterministicSummary, ...safeAdvice, actions, facts, model: 'Qwen3.5-0.8B（浏览器 WebGPU 本机推理）', createdAt: new Date().toLocaleString('zh-CN') })
      setAiStatus('已由本机 Qwen3.5 实际生成。数据未发送到模型服务商。')
    } catch (error) {
      console.error(`[Qwen3.5 · ${stage}]`, error)
      setAiStatus(`AI 报告未生成（${stage}）：${error.message}`)
    } finally {
      setAiBusy(false)
    }
  }

  function downloadAiReport() {
    if (!aiReport) return
    const need = aiReport.facts.needSimulation
    const scenarioLines = aiReport.facts.scenarioComparison.map(item => `- ${item.name}：¥${formatMoney(item.endingBalance)}（相对当前规划 ${item.deltaFromCurrentPlan >= 0 ? '+' : '−'}¥${formatMoney(Math.abs(item.deltaFromCurrentPlan))}）`)
    const content = ['# 千程智财 · 青年财富情景分析报告', '', `生成时间：${aiReport.createdAt}`, `实际生成模型：${aiReport.model}`, `选中情景：${aiReport.facts.selectedScenario.name}（${aiReport.facts.selectedScenario.adjustment}）`, '', '## 多情景期末对照', ...scenarioLines, '', `当前情景期末余额：¥${formatMoney(aiReport.facts.results.endingBalanceBase)}；收益假设敏感性区间：¥${formatMoney(aiReport.facts.results.endingBalanceLow)}—¥${formatMoney(aiReport.facts.results.endingBalanceHigh)}。`, `需求模拟：${need.name} ¥${formatMoney(need.amount)}，第 ${need.month} 个月；发生前 ¥${formatMoney(need.balanceBefore)}，支出后 ¥${formatMoney(need.balanceAfter)}，资金缺口 ¥${formatMoney(need.fundingGap)}；${need.includedInMainCurve ? '已计入主曲线' : '未计入主曲线'}。`, '', '## 情景概述', aiReport.summary, '', '## 现金流建议', aiReport.cashflowAdvice, '', '## 投资教育建议', aiReport.investingEducation, '', '## 风险提示', aiReport.riskNotes, '', '## 可执行事项', ...aiReport.actions.map(item => `- ${item}`), '', '本报告由 AI 生成，仅供财务教育与情景讨论。模拟依赖用户输入，非收益预测或个性化证券投资建议。'].join('\n')
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }))
    link.download = '千程智财-青年财富AI分析报告.md'
    link.click()
    URL.revokeObjectURL(link.href)
  }

  function resetExample() {
    aiInputRevision.current += 1
    setValues(INITIAL)
    setActiveScenarioId('base')
    setDemand(INITIAL_NEED)
    setAiReport(null)
    setAiStatus(aiBusy ? '示例参数已恢复；当前分析完成后将丢弃旧结果。' : '尚未调用模型')
  }

  async function copySummary() {
    const text = `千程智财青年现金流情景\n选中情景：${activeScenario.label}（${activeScenario.adjustment}）\n起始资产：¥${formatMoney(effectiveValues.principal)}\n在校月结余：¥${formatMoney(effectiveValues.monthly)}\n毕业求职过渡：${effectiveValues.searchMonths}个月\n毕业后税后月薪假设：¥${formatMoney(effectiveValues.salary)}\n毕业后房租：¥${formatMoney(effectiveValues.rent)}\n测算期限：${effectiveValues.years}年\n收益率假设：${effectiveValues.annualRate}%（非收益承诺）\n期末余额：约¥${formatMoney(projection.base)}\n${effectiveDemand.label}：¥${formatMoney(effectiveDemand.amount)}，第${effectiveDemand.month}个月；支出后约¥${formatMoney(needResult.afterBalance)}；${effectiveDemand.enabled ? '计入主曲线' : '未计入主曲线'}\n敏感性对照：约¥${formatMoney(projection.low)}—¥${formatMoney(projection.high)}`
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div id="top" className="relative isolate min-h-screen overflow-hidden bg-ink text-copy selection:bg-cyan/25">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(180,220,230,.035)_1px,transparent_1px),linear-gradient(to_bottom,rgba(180,220,230,.035)_1px,transparent_1px)] [background-size:68px_68px] [mask-image:linear-gradient(to_bottom,black,transparent_86%)]" />
        <motion.div
          className="absolute -right-[18%] -top-[26%] h-[72vw] w-[72vw] max-h-[1000px] max-w-[1000px] rounded-full bg-cyan/[0.07] blur-[150px]"
          animate={reducedMotion ? undefined : { x: [0, -28, 0], y: [0, 24, 0], scale: [1, 1.07, 1] }}
          transition={{ duration: 24, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute -bottom-[38%] left-[2%] h-[60vw] w-[60vw] max-h-[820px] max-w-[820px] rounded-full bg-blue/[0.055] blur-[150px]"
          animate={reducedMotion ? undefined : { x: [0, 22, 0], y: [0, -15, 0] }}
          transition={{ duration: 29, repeat: Infinity, ease: 'easeInOut' }}
        />
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan/40 to-transparent" />
      </div>

      <header className="relative z-10 mx-auto flex h-[76px] max-w-[1700px] items-center justify-between px-5 sm:px-8 lg:px-12">
        <a href="#top" className="group flex items-center gap-3" aria-label="千程智财首页">
          <span className="relative flex h-9 w-9 items-center justify-center rounded-full border border-cyan/30 text-cyan">
            <Orbit size={19} strokeWidth={1.5} />
            <span className="absolute right-[2px] top-[4px] h-1.5 w-1.5 rounded-full bg-cyan shadow-[0_0_10px_2px_rgba(124,228,228,.6)]" />
          </span>
          <span>
            <span className="block text-sm font-semibold tracking-[.08em] text-copy">千程智财</span>
            <span className="mt-0.5 block font-display text-[9px] tracking-[.22em] text-faint">QIANCHENG · FINANCE LAB</span>
          </span>
        </a>

        <nav className="hidden items-center gap-9 text-[13px] text-muted md:flex" aria-label="主导航">
          <a className="transition-colors hover:text-copy" href="#curve">资金曲线</a>
          <a className="transition-colors hover:text-copy" href="#planning">青年规划</a>
          <a className="transition-colors hover:text-copy" href="#model">模型说明</a>
        </nav>

        <div className="flex items-center gap-3 sm:gap-5">
          <div className="hidden items-center gap-2 text-xs text-muted sm:flex">
            <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan/60 opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-cyan" /></span>
            本地即时测算
          </div>
          <a href="#planning" className="hidden items-center gap-2 border-b border-white/20 pb-1 text-xs text-copy transition-colors hover:border-cyan hover:text-cyan sm:flex">
            调整规划 <ChevronDown size={13} className="-rotate-90" />
          </a>
        </div>
      </header>

      <main className="relative mx-auto max-w-[1700px] px-5 pb-14 pt-5 sm:px-8 sm:pt-8 lg:px-12">
        <WealthHero projection={projection} values={effectiveValues} scenarioLabel={activeScenario.label} demand={effectiveDemand} reducedMotion={reducedMotion} />
        <section id="curve" ref={chartRef} className="scroll-mt-8">
          <div className="grid items-end gap-4 min-[560px]:grid-cols-[minmax(0,1fr)_auto]">
            <motion.div
              initial={reducedMotion ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reducedMotion ? 0 : 0.48, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="mb-3 flex items-center gap-3 text-xs text-cyan">
                <span className="h-px w-7 bg-cyan/70" />
                千程智财 · 青年资产时间线
              </div>
              <h1 className="font-display text-2xl font-medium tracking-[-.045em] text-copy sm:text-3xl">
                资金曲线，先看见。
              </h1>
              <p className="mt-2 text-xs leading-5 text-muted sm:text-[13px]">
                在校起点 · 毕业过渡 · 职场起步 · 长期目标
              </p>
            </motion.div>

            <motion.div
              className="flex items-end justify-between gap-4 border-t border-white/[0.09] pt-3 min-[560px]:min-w-[210px] min-[560px]:justify-end min-[560px]:gap-5 min-[560px]:border-t-0 min-[560px]:pt-0"
              initial={reducedMotion ? false : { opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: reducedMotion ? 0 : 0.48, delay: reducedMotion ? 0 : 0.06, ease: [0.16, 1, 0.3, 1] }}
            >
              <div>
                <div className="mb-1 text-[11px] text-muted">{values.years} 年后 · {activeScenario.label}期末</div>
                <div className="font-display text-3xl font-medium tracking-[-.05em] text-copy sm:text-4xl" aria-live="polite" aria-atomic="true">
                  <span className="mr-1 align-top font-sans text-xs font-normal tracking-normal text-muted">¥</span>
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.span
                      key={Math.round(projection.base)}
                      initial={reducedMotion ? false : { opacity: 0, y: 8, filter: 'blur(3px)' }}
                      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                      exit={reducedMotion ? undefined : { opacity: 0, y: -5, filter: 'blur(2px)' }}
                      transition={{ duration: reducedMotion ? 0 : 0.3, ease: [0.16, 1, 0.3, 1] }}
                      className="tabular-nums"
                    >
                      {formatMoney(projection.base)}
                    </motion.span>
                  </AnimatePresence>
                </div>
                <div className="mt-1 text-[10px] text-faint">年化假设 {values.annualRate.toFixed(1)}%</div>
              </div>
              <button type="button" onClick={copySummary} aria-label="复制测算摘要" className="mb-1 inline-flex h-9 w-9 shrink-0 items-center justify-center border border-white/10 text-muted transition-colors hover:border-cyan/40 hover:text-cyan">
                <AnimatePresence mode="wait" initial={false}>
                  {copied ? <motion.span key="copied" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><Check size={14} className="text-cyan" /></motion.span> : <motion.span key="copy" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><Copy size={14} /></motion.span>}
                </AnimatePresence>
              </button>
            </motion.div>
          </div>
          <motion.div
            className="mt-8 border-y border-white/[0.09] py-4 sm:mt-10"
            initial={reducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: reducedMotion ? 0 : 0.55, delay: reducedMotion ? 0 : 0.16 }}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[11px] text-muted">
                <span className="inline-flex items-center gap-2"><i className="h-0.5 w-5 bg-gradient-to-r from-blue to-cyan" />基准路径</span>
                <span className="inline-flex items-center gap-2"><i className="h-px w-5 border-t border-dashed border-[#8096a3]/60" />敏感性区间</span>
              </div>
              <span className="inline-flex items-center gap-1.5 text-[11px] text-faint"><CircleHelp size={12} />收益率 ±2.5 个百分点 · 非概率区间</span>
            </div>

            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-[11px] text-muted">
              <span className="inline-flex items-center gap-2"><i className="h-2 w-2 rounded-full bg-[#e8b68f]" />一次性支出节点</span>
              <span>{activeScenario.label} · {activeScenario.adjustment}</span>
            </div>
            <AssetChart projection={projection} years={values.years} reducedMotion={reducedMotion} milestones={milestones} animationKey={chartRevision} demand={effectiveDemand} />
          </motion.div>

          <div className="relative mt-5">
            <div aria-hidden="true" className="absolute left-[12.5%] right-[12.5%] top-[10px] hidden h-px bg-white/10 md:block">
              <motion.div className="h-full origin-left bg-cyan/60" initial={reducedMotion ? false : { scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: reducedMotion ? 0 : 0.8, delay: reducedMotion ? 0 : 0.5, ease: [0.16, 1, 0.3, 1] }} />
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-4 md:gap-5">
              {milestones.map((milestone, index) => {
                const point = projection.points[milestone.index]
                return (
                  <motion.div
                    key={milestone.title}
                    className="relative"
                    initial={reducedMotion ? false : { opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: reducedMotion ? 0 : 0.34, delay: reducedMotion ? 0 : 0.18 + index * 0.07, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <span className={"relative z-[1] mb-3 block h-[7px] w-[7px] rounded-full ring-[5px] ring-ink " + (index === milestones.length - 1 ? "bg-cyan shadow-[0_0_14px_2px_rgba(124,228,228,.4)]" : "bg-[#84949e]")} />
                    <div className="text-sm font-medium text-copy">{milestone.title}</div>
                    <div className="mt-1 text-[11px] text-faint">{milestone.detail}</div>
                    <div className="mt-2 font-mono text-sm tabular-nums text-muted">
                      <AnimatePresence mode="wait" initial={false}>
                        <motion.span key={Math.round(point.base)} initial={reducedMotion ? false : { opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={reducedMotion ? undefined : { opacity: 0, y: -4 }} transition={{ duration: reducedMotion ? 0 : 0.24 }}>
                          ¥{formatCompact(point.base)}
                        </motion.span>
                      </AnimatePresence>
                    </div>
                  </motion.div>
                )
              })}
            </div>
          </div>

          <div className="mt-7 grid gap-5 border-t border-white/[0.08] pt-4 sm:grid-cols-3 sm:gap-8">
            <div>
              <div className="text-[11px] text-muted">累计净现金流</div>
              <div className="mt-1.5 font-mono text-base tabular-nums text-copy">¥{formatCompact(projection.invested)}</div>
            </div>
            <div className="sm:border-l sm:border-white/[0.09] sm:pl-6">
              <div className="text-[11px] text-muted">情景增量</div>
              <div className="mt-1.5 font-mono text-base tabular-nums text-cyan">¥{formatCompact(growth)}</div>
            </div>
            <div className="sm:border-l sm:border-white/[0.09] sm:pl-6">
              <div className="text-[11px] text-muted">终值敏感性参考</div>
              <div className="mt-1.5 font-mono text-sm tabular-nums text-copy">¥{formatCompact(projection.low)} <span className="text-faint">—</span> ¥{formatCompact(projection.high)}</div>
            </div>
          </div>
        </section>

        <section id="planning" className="mt-16 border-t border-white/[0.1] pt-12 sm:mt-20 sm:pt-14">
          <div className="grid gap-9 lg:grid-cols-[0.78fr_1.22fr] lg:gap-16">
            <div>
              <div className="mb-4 flex items-center gap-3 text-xs text-cyan">
                <span className="h-px w-7 bg-cyan/60" />
                青年现金流规划
              </div>
              <h2 className="max-w-[480px] font-display text-3xl font-medium leading-tight tracking-[-.045em] text-copy sm:text-4xl">
                下一程，<br />从今天的数字开始。
              </h2>
              <p className="mt-5 max-w-[460px] text-sm leading-7 text-muted">
                试着把在校阶段的积累、毕业过渡期的支出和入职后的月度投入放进同一张图。改动参数，曲线即时更新。
              </p>
              <div className="mt-6 flex items-start gap-3 border-l border-cyan/40 pl-4 text-xs leading-6 text-faint">
                <ShieldCheck size={15} className="mt-1 shrink-0 text-cyan/70" />
                不需要绑定账户。这里展示的是假设情景，不代表未来收益。
              </div>
            </div>

            <div className="min-w-0">
              <div className="mb-4 flex items-center gap-2 text-xs text-muted">
                <SlidersHorizontal size={14} className="text-cyan/80" />
                调整曲线参数
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <NumericField label="现在已有" suffix="起始资产" value={values.principal} min={0} max={100000000} step={1000} onChange={(value) => update('principal', value)} />
                <NumericField label="在校月结余" suffix="收入减日常支出" value={values.monthly} min={-100000} max={1000000} step={100} onChange={(value) => update('monthly', value)} />
                <NumericField label="在校阶段" suffix="距毕业月数" value={values.schoolMonths} min={1} max={240} prefix="" onChange={(value) => update('schoolMonths', value)} />
                <NumericField label="求职过渡" suffix="预计月数" value={values.searchMonths} min={0} max={60} prefix="" onChange={(value) => update('searchMonths', value)} />
                <NumericField label="过渡期支持" suffix="月均家庭支持" value={values.graduateSupport} min={0} max={1000000} step={100} onChange={(value) => update('graduateSupport', value)} />
                <NumericField label="毕业后月薪" suffix="税后情景收入" value={values.salary} min={0} max={1000000} step={500} onChange={(value) => update('salary', value)} />
                <NumericField label="毕业后房租" suffix="月均住房支出" value={values.rent} min={0} max={1000000} step={100} onChange={(value) => update('rent', value)} />
                <NumericField label="毕业后生活费" suffix="月均其他支出" value={values.living} min={0} max={1000000} step={100} onChange={(value) => update('living', value)} />
              </div>

              <div className="mt-3 rounded-xl border border-white/[0.075] bg-white/[0.025] px-4 py-3.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="rate" className="text-xs text-muted">年化收益假设</label>
                  <span className="font-mono text-sm tabular-nums text-copy">{values.annualRate.toFixed(1)}<span className="ml-1 text-xs text-muted">%</span></span>
                </div>
                <input
                  id="rate"
                  type="range"
                  min="0"
                  max="12"
                  step="0.1"
                  value={values.annualRate}
                  onChange={(event) => update('annualRate', Number(event.target.value))}
                  className="mt-3 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-cyan"
                  aria-label="年化收益假设百分比"
                />
                <div className="mt-1.5 flex justify-between font-mono text-[10px] text-faint"><span>0%</span><span>6%</span><span>12%</span></div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="mr-1 text-xs text-muted">时间跨度</span>
                {YEAR_OPTIONS.map((year) => (
                  <motion.button
                    key={year}
                    type="button"
                    whileTap={reducedMotion ? undefined : { scale: 0.96 }}
                    onClick={() => update('years', year)}
                    aria-pressed={values.years === year}
                    className={"min-w-[48px] border px-3 py-2 text-xs transition-colors " + (values.years === year ? "border-cyan/45 bg-cyan/[0.1] text-cyan" : "border-white/10 text-muted hover:border-white/25 hover:text-copy")}
                  >
                    {year} 年
                  </motion.button>
                ))}
                <span className="ml-auto text-[11px] text-faint">测算期限</span>
              </div>
            </div>
          </div>

              <ScenarioLab
                scenarios={scenarioRows}
                activeScenarioId={activeScenarioId}
                onSelectScenario={selectScenario}
                demand={effectiveDemand}
                presets={NEED_PRESETS}
                horizonMonths={effectiveValues.years * MONTHS_PER_YEAR}
                needResult={needResult}
                onPresetChange={presetId => {
                  const preset = NEED_PRESETS.find(item => item.id === presetId) ?? NEED_PRESETS[0]
                  updateDemand({ preset: preset.id, label: preset.id === 'custom' ? '我的目标' : preset.label, amount: preset.amount })
                }}
                onDemandNameChange={label => updateDemand({ label })}
                onDemandAmountChange={amount => updateDemand({ amount: Math.min(500000, Math.max(0, amount)) })}
                onDemandMonthChange={month => updateDemand({ month })}
                onToggleDemand={() => updateDemand({ enabled: !effectiveDemand.enabled })}
                reducedMotion={reducedMotion}
              />

              <div className="mt-8 max-w-[1200px] border-t border-white/10 pt-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div><div className="text-sm text-copy">AI 青年财富分析</div><div className="mt-1 text-xs leading-5 text-muted">本机 Qwen3.5 · 报告包含所选情景、需求资金和现金流事实</div></div>
                  <button type="button" onClick={generateAiReport} disabled={aiBusy} className="rounded-full bg-cyan px-5 py-3 text-sm font-medium text-[#071216] transition-colors hover:bg-[#a9f1e9] disabled:cursor-wait disabled:opacity-60">{aiBusy ? '分析中…' : aiReport ? '重新生成报告' : '生成财务分析'}</button>
                </div>
                <p role="status" aria-live="polite" className="mt-3 text-xs leading-5 text-muted">{aiStatus}</p>
                {aiReport && <div className="mt-4 space-y-4 border-l border-cyan/40 pl-4 text-sm leading-6 text-[#d7e8e8]">
                  <div><h3 className="font-medium text-cyan">情景观察</h3><p>{aiReport.summary}</p></div>
                  <div><h3 className="font-medium text-cyan">现金流建议</h3><p>{aiReport.cashflowAdvice}</p></div>
                  <div><h3 className="font-medium text-cyan">投资教育</h3><p>{aiReport.investingEducation}</p></div>
                  <div><h3 className="font-medium text-cyan">风险提醒</h3><p>{aiReport.riskNotes}</p></div>
                  <ol className="list-inside list-decimal">{aiReport.actions.slice(0, 3).map((item, index) => <li key={index}>{item}</li>)}</ol>
                  <p className="text-[11px] text-faint">{aiReport.model} · {aiReport.createdAt} · 学习与情景讨论用途</p>
                  <button type="button" onClick={downloadAiReport} className="border-b border-white/30 pb-1 text-xs text-copy hover:border-cyan hover:text-cyan">下载分析报告（Markdown）</button>
                </div>}
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-4">
                <motion.button
                  type="button"
                  whileHover={reducedMotion ? undefined : { y: -2 }}
                  whileTap={reducedMotion ? undefined : { scale: 0.98 }}
                  onClick={() => chartRef.current?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' })}
                  className="group inline-flex items-center gap-3 bg-cyan px-5 py-3.5 text-[13px] font-semibold text-[#071216] transition-colors hover:bg-[#a9f1e9]"
                >
                  回到曲线看变化 <ArrowUpRight size={15} className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </motion.button>
                <button type="button" onClick={resetExample} className="inline-flex items-center gap-2 py-2 text-xs text-muted transition-colors hover:text-copy">
                  <RotateCcw size={13} /> 恢复示例
                </button>
              </div>
        </section>

        <div className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.07] py-4 text-[10px] text-faint">
          <span>千程智财 · 青年资产认知实验室</span>
          <span className="flex items-center gap-2"><span className="font-mono">YOUTH FINANCIAL JOURNEY</span><span className="h-px w-8 bg-white/15" />仅用于学习与情景比较</span>
        </div>
      </main>

      <section id="model" className="relative border-t border-white/[0.08] bg-[#0a1118]/85 px-5 py-16 sm:px-8 lg:px-12 lg:py-20">
        <div className="mx-auto grid max-w-[1460px] gap-10 lg:grid-cols-[.72fr_1.28fr] lg:gap-20">
          <div>
            <div className="mb-4 flex items-center gap-3 text-xs text-cyan"><span className="h-px w-7 bg-cyan/60" />模型说明</div>
            <h2 className="max-w-[440px] font-display text-3xl font-medium leading-tight tracking-[-.045em] text-copy sm:text-4xl">曲线展示的是<br />假设如何变化。</h2>
            <p className="mt-5 max-w-[440px] text-sm leading-7 text-muted">不是对市场的预测。把它当作一张可交互的草图：看投入节奏、持有时间与收益假设如何共同影响结果。</p>
          </div>
          <div className="grid gap-7 sm:grid-cols-3 sm:gap-8">
            <div className="border-t border-white/15 pt-4">
              <span className="font-mono text-[11px] text-cyan">复利计算</span>
            <p className="mt-3 text-sm leading-6 text-copy">每月按假设收益率折算非负余额，再计入在校结余、求职期净支出或入职后净结余。需求模拟可额外加入一次性支出；负余额作为未覆盖缺口，不计收益。</p>
            </div>
            <div className="border-t border-white/15 pt-4">
              <span className="font-mono text-[11px] text-cyan">区间对照</span>
              <p className="mt-3 text-sm leading-6 text-copy">上下边界是基准年化假设的 ±2.5 个百分点，用来观察敏感性，不代表概率范围。</p>
            </div>
            <div id="principles" className="border-t border-white/15 pt-4">
              <span className="font-mono text-[11px] text-cyan">使用边界</span>
              <p className="mt-3 text-sm leading-6 text-copy">未计入通胀、税费与交易成本。真实收益会波动，也可能亏损；请勿据此作出投资决定。</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

export default App
