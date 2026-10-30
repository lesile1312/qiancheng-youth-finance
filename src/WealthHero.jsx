import { useRef, useState } from 'react'
import { motion, useScroll, useTransform } from 'framer-motion'
import { ArrowDownRight } from 'lucide-react'

const money = value => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(Math.round(value))

function OceanWaves({ reducedMotion }) {
  const drift = (distance, duration) => reducedMotion ? {} : {
    animate: { x: [0, distance, 0], y: [0, -12, 0] },
    transition: { duration, repeat: Infinity, ease: 'easeInOut' },
  }
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <motion.div {...(reducedMotion ? {} : { animate: { opacity: [.3, .55, .3], scale: [1, 1.08, 1] }, transition: { duration: 14, repeat: Infinity, ease: 'easeInOut' } })} className="absolute -right-[12%] top-[10%] h-[65%] w-[68%] rounded-full bg-[#4ac9c8]/20 blur-[95px]" />
      <svg viewBox="0 0 1440 900" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
        <defs>
          <linearGradient id="oceanFar" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#6ed8d4" stopOpacity=".28"/><stop offset="1" stopColor="#075668" stopOpacity=".05"/></linearGradient>
          <linearGradient id="oceanMid" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#33adbd" stopOpacity=".30"/><stop offset="1" stopColor="#052c43" stopOpacity=".18"/></linearGradient>
          <linearGradient id="oceanNear" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#73e2d4" stopOpacity=".18"/><stop offset="1" stopColor="#021421" stopOpacity=".55"/></linearGradient>
          <linearGradient id="foam" x1="0" x2="1"><stop stopColor="#93ece6" stopOpacity="0"/><stop offset=".48" stopColor="#b8fff0" stopOpacity=".5"/><stop offset="1" stopColor="#a3f3eb" stopOpacity="0"/></linearGradient>
        </defs>
        <motion.g {...drift(-55, 19)}>
          <path d="M-180 510 C20 330 210 310 405 390 C610 478 700 510 900 384 C1080 272 1260 290 1630 385 L1630 980 L-180 980 Z" fill="url(#oceanFar)" />
          <path d="M-180 510 C20 330 210 310 405 390 C610 478 700 510 900 384 C1080 272 1260 290 1630 385" fill="none" stroke="url(#foam)" strokeWidth="3" />
          <path d="M-180 535 C20 355 210 335 405 415 C610 503 700 535 900 409 C1080 297 1260 315 1630 410" fill="none" stroke="#a4f5e8" strokeOpacity=".13" />
        </motion.g>
        <motion.g {...drift(85, 23)}>
          <path d="M-200 610 C30 495 175 550 350 595 C560 650 675 522 840 490 C1070 445 1200 535 1650 460 L1650 980 L-200 980 Z" fill="url(#oceanMid)" />
          <path d="M-200 610 C30 495 175 550 350 595 C560 650 675 522 840 490 C1070 445 1200 535 1650 460" fill="none" stroke="url(#foam)" strokeWidth="2" />
          <path d="M-150 634 C35 520 180 575 355 620 C565 675 680 547 845 515 C1075 470 1205 560 1600 485" fill="none" stroke="#b4fff4" strokeOpacity=".14" />
        </motion.g>
        <motion.g {...drift(-65, 16)}>
          <path d="M-160 720 C70 620 210 665 390 706 C595 752 735 640 930 620 C1140 600 1280 680 1610 590 L1610 980 L-160 980 Z" fill="url(#oceanNear)" />
          <path d="M-160 720 C70 620 210 665 390 706 C595 752 735 640 930 620 C1140 600 1280 680 1610 590" fill="none" stroke="url(#foam)" strokeWidth="3" />
          <path d="M-130 746 C70 648 210 693 390 734 C595 780 735 668 930 648 C1140 628 1280 708 1580 618" fill="none" stroke="#b2fff2" strokeOpacity=".12" />
        </motion.g>
      </svg>
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(3,17,24,.08)_0%,transparent_38%,rgba(3,14,23,.22)_100%)]" />
    </div>
  )
}

export default function WealthHero({ projection, values, reducedMotion: motionPreference }) {
  const [motionPaused, setMotionPaused] = useState(false)
  const reducedMotion = motionPreference || motionPaused
  const ref = useRef(null)
  const svgRef = useRef(null)
  const [hover, setHover] = useState(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] })
  const depth = useTransform(scrollYProgress, [0, 1], [0, 90])
  const foreground = useTransform(scrollYProgress, [0, 1], [0, -45])
  const points = projection.points
  const max = Math.max(projection.high * 1.1, 1)
  const x = i => 65 + i / (points.length - 1) * 1070
  const y = value => 350 - value / max * 285
  const path = key => points.map((point, i) => `${i ? 'L' : 'M'} ${x(i).toFixed(1)} ${y(point[key]).toFixed(1)}`).join(' ')
  const line = path('base')
  const band = `${path('high')} ${[...points].reverse().map((point, reverseIndex) => `L ${x(points.length - 1 - reverseIndex).toFixed(1)} ${y(point.low).toFixed(1)}`).join(' ')} Z`
  const area = `${line} L 1135 350 L 65 350 Z`
  const totalMonths = values.years * 12
  const stages = [
    { title: '在校起点', month: 0 },
    { title: '毕业过渡', month: Math.min(24, Math.max(12, Math.round(totalMonths * .25))) },
    { title: '职场起步', month: Math.min(totalMonths, Math.max(Math.min(24, Math.max(12, Math.round(totalMonths * .25))) + 6, Math.min(48, Math.round(totalMonths * .45)))) },
    { title: '长期目标', month: totalMonths },
  ].map(stage => ({ ...stage, index: Math.round(stage.month / totalMonths * (points.length - 1)) }))
  const selectedIndex = hover ?? points.length - 1
  const selected = points[selectedIndex]
  const revision = `${values.principal}-${values.monthly}-${values.years}-${values.annualRate}`

  function track(event) {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const coordinate = (event.clientX - rect.left) / rect.width * 1200
    setHover(Math.round(Math.max(0, Math.min(1, (coordinate - 65) / 1070)) * (points.length - 1)))
  }

  return (
    <section ref={ref} aria-label="财富曲线首页" className="relative isolate -mx-5 -mt-5 mb-16 overflow-hidden bg-[#06151c] px-5 sm:-mx-8 sm:-mt-8 sm:px-8 lg:-mx-12 lg:px-12">
      <motion.div aria-hidden="true" style={reducedMotion ? undefined : { y: depth }} className="pointer-events-none absolute -inset-x-12 -top-24 bottom-0 -z-10 bg-[radial-gradient(ellipse_at_80%_20%,rgba(69,174,173,.23),transparent_42%),radial-gradient(ellipse_at_25%_75%,rgba(26,105,129,.27),transparent_48%),linear-gradient(165deg,#0b2932,#071b24_50%,#030d16)]" />
      <OceanWaves reducedMotion={reducedMotion} />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(200,245,240,.035)_1px,transparent_1px)] [background-size:12.5%_100%]" />
      <motion.div style={reducedMotion ? undefined : { y: foreground }} className="relative mx-auto flex min-h-[calc(100svh-76px)] max-w-[1604px] flex-col pb-5 pt-8 sm:pt-12 lg:pt-14">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="flex items-center gap-3 text-xs tracking-[.12em] text-[#a3ddd9]"><span className="h-px w-8 bg-[#a3ddd9]" />千程智财 / 青年财富旅程</p>
            <h1 className="mt-4 text-[clamp(2.2rem,4.6vw,5rem)] font-light leading-[1.1] tracking-[-.05em] text-[#edf9f6]">让积累，看得见未来。</h1>
            <p className="mt-3 text-sm leading-6 text-[#a7c7c5]">从校园出发，让时间描绘你的财富轨迹。</p>
          </div>
          <div className="border-l border-[#9ce3dc]/30 pl-5">
            <p className="text-xs text-[#a6c3c0]">{hover === null ? `${values.years} 年后 · 基准情景` : `${(selected.month / 12).toFixed(selected.month % 12 ? 1 : 0)} 年后 · 基准情景`}</p>
            <motion.p key={Math.round(selected.base)} initial={reducedMotion ? false : { opacity: .5, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .24 }} className="mt-1 font-display text-3xl tabular-nums tracking-[-.05em] text-[#edfffa] sm:text-4xl"><span className="mr-2 text-sm text-[#a6c3c0]">¥</span>{money(selected.base)}</motion.p>
            <p className="mt-2 text-xs text-[#91b2b2]">年化假设 {values.annualRate.toFixed(1)}% · 非收益承诺</p>
          </div>
        </div>
        <div className="relative mt-7 flex min-h-[250px] flex-1 flex-col justify-end sm:mt-9">
          <div className="mb-2 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-[#a7c6c4]"><span className="flex items-center gap-2"><i className="h-[2px] w-6 bg-[#9ef3e6]" />基准路径</span><span className="flex items-center gap-2"><i className="h-2 w-6 bg-[#8bded7]/20" />敏感性区间</span><span className="ml-auto hidden sm:block">悬停或用方向键探索</span><button type="button" onClick={() => setMotionPaused(paused => !paused)} aria-pressed={motionPaused} className="rounded-full border border-white/20 px-3 py-2 text-[#d7eeeb] transition-colors hover:bg-white/10">{motionPaused ? "播放海浪" : "暂停海浪"}</button></div>
          <svg ref={svgRef} onPointerMove={track} onPointerLeave={() => setHover(null)} viewBox="0 0 1200 390" preserveAspectRatio="none" role="slider" tabIndex={0} aria-label="探索财富曲线时点" aria-valuemin={0} aria-valuemax={totalMonths} aria-valuenow={selected.month} aria-valuetext={`${selected.month}个月，基准资产${money(selected.base)}元`} onKeyDown={event => { if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return; event.preventDefault(); setHover(event.key === "Home" ? 0 : event.key === "End" ? points.length - 1 : Math.max(0, Math.min(points.length - 1, selectedIndex + (event.key === "ArrowRight" ? 1 : -1)))) }} className="block h-[250px] w-full touch-pan-y sm:h-[320px] lg:h-[min(44vh,440px)]">
            <defs><linearGradient id="heroLine" x1="0" y1="0" x2="1" y2="0"><stop stopColor="#85bfff"/><stop offset=".55" stopColor="#7ae1dc"/><stop offset="1" stopColor="#e0fff0"/></linearGradient><linearGradient id="heroWater" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#66e0d8" stopOpacity=".24"/><stop offset="1" stopColor="#2e9ba8" stopOpacity="0"/></linearGradient><filter id="heroGlow"><feGaussianBlur stdDeviation="7"/></filter></defs>
            {[0,1,2,3,4].map(i => <g key={i}><line x1="65" x2="1135" y1={350-i*71.25} y2={350-i*71.25} stroke="#b1e6e0" strokeOpacity=".11" strokeDasharray="3 9"/><text x="0" y={354-i*71.25} fill="#92b2b0" fontSize="12">{i === 0 ? '0' : `${(max*i/4/10000).toFixed(1)}万`}</text></g>)}
            <motion.path key={`band-${revision}`} d={band} fill="#88e1db" initial={reducedMotion ? false : {opacity:0}} animate={{opacity:.12}} transition={{duration:1.2}} />
            <motion.path key={`area-${revision}`} d={area} fill="url(#heroWater)" initial={reducedMotion ? false : {opacity:0}} animate={{opacity:1}} transition={{duration:1.4}} />
            <path d={path('low')} fill="none" stroke="#9de2de" strokeOpacity=".32" strokeWidth="1.2" strokeDasharray="5 8"/><path d={path('high')} fill="none" stroke="#9de2de" strokeOpacity=".32" strokeWidth="1.2" strokeDasharray="5 8"/>
            <path d={line} fill="none" stroke="#8efcf0" strokeOpacity=".28" strokeWidth="12" filter="url(#heroGlow)" />
            <motion.path key={`line-${revision}`} d={line} fill="none" stroke="url(#heroLine)" strokeWidth="3" strokeLinecap="round" initial={reducedMotion ? false : {pathLength:0}} animate={{pathLength:1}} transition={{duration:1.6,ease:[0.16,1,0.3,1]}} />
            {!reducedMotion && <g key={`traveller-${revision}`}><circle r="9" fill="#9affed" opacity=".3" filter="url(#heroGlow)"><animateMotion path={line} dur="6s" begin="1.6s" repeatCount="indefinite" /></circle><circle r="3" fill="#edfff9"><animateMotion path={line} dur="6s" begin="1.6s" repeatCount="indefinite" /></circle></g>}
            {stages.map((stage, i) => <motion.g key={`${stage.title}-${revision}`} initial={reducedMotion ? false : {opacity:0,scale:.6}} animate={{opacity:1,scale:1}} transition={{delay:reducedMotion ? 0 : .3+i*.25,duration:.4}}><circle cx={x(stage.index)} cy={y(points[stage.index].base)} r="14" fill="#9effec" opacity=".1"/><circle cx={x(stage.index)} cy={y(points[stage.index].base)} r="4" fill="#e0fff9"/></motion.g>)}
            {hover !== null && <g pointerEvents="none"><line x1={x(hover)} x2={x(hover)} y1="45" y2="350" stroke="#d8fff7" strokeOpacity=".4" strokeDasharray="4 7"/><circle cx={x(hover)} cy={y(selected.base)} r="7" fill="#dcfff7" stroke="#123b3b" strokeWidth="3"/></g>}
            <text x="65" y="380" fill="#91b2b2" fontSize="12">现在</text><text x="1135" y="380" fill="#91b2b2" fontSize="12" textAnchor="end">{values.years} 年</text>
          </svg>
        </div>
        <div className="mt-4 grid grid-cols-4 gap-2 border-t border-white/15 pt-4 sm:gap-6">
          {stages.map((stage, i) => <motion.button type="button" onClick={() => setHover(stage.index)} aria-pressed={hover === stage.index} className="rounded-lg px-2 py-2 text-left transition-colors hover:bg-white/10 focus-visible:bg-white/10" key={stage.title} initial={reducedMotion ? false : {opacity:0,y:8}} animate={{opacity:1,y:0}} transition={{delay:reducedMotion ? 0 : .3+i*.1,duration:.4}}><p className="text-[11px] text-[#a7c6c4] sm:text-xs">{stage.title}</p><p className="mt-1 text-xs tabular-nums text-[#ecfffb] sm:text-sm">¥ {money(points[stage.index].base)}</p></motion.button>)}
        </div>
        <div className="mt-5 flex items-center justify-between gap-3 border-t border-white/10 pt-4 text-xs text-[#a7c6c4]"><span>按月投入 ¥{money(values.monthly)} <span className="mx-2 text-white/20">/</span> 敏感性区间为假设对照</span><a href="#curve" className="flex shrink-0 items-center gap-2 text-[#e5faf4] transition-colors hover:text-[#9ef3e6]">探索详情 <ArrowDownRight size={16}/></a></div>
      </motion.div>
    </section>
  )
}
