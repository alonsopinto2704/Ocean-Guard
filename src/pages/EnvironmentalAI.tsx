import React, { useState } from 'react';
import { AlertTriangle, Brain, TrendingUp, Activity, Radio, Target, Zap } from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Cell
} from 'recharts';
import { Card, CardHeader, StatCard } from '../components/ui/Card';

const TREND_DATA = [
  { date: 'Aug 24', plastic: 142, fishingGear: 48, metalGlass: 28, other: 14 },
  { date: 'Aug 25', plastic: 168, fishingGear: 52, metalGlass: 31, other: 19 },
  { date: 'Aug 26', plastic: 155, fishingGear: 60, metalGlass: 29, other: 16 },
  { date: 'Aug 27', plastic: 184, fishingGear: 74, metalGlass: 34, other: 22 },
  { date: 'Aug 28', plastic: 190, fishingGear: 82, metalGlass: 38, other: 25 },
  { date: 'Aug 29', plastic: 215, fishingGear: 94, metalGlass: 42, other: 28 },
  { date: 'Aug 30', plastic: 232, fishingGear: 104, metalGlass: 46, other: 30 },
];

const CATEGORY_BAR = [
  { name: 'Plastic',      value: 638, color: '#00d4ff' },
  { name: 'Fishing Gear', value: 312, color: '#ffaa00' },
  { name: 'Metal/Glass',  value: 198, color: '#aa55ff' },
  { name: 'Organic',      value: 89,  color: '#00ff88' },
  { name: 'Unknown',      value: 47,  color: '#6a9ab8' },
];

const RISK_DIST = [
  { name: 'LOW',      value: 412, color: '#00ff88' },
  { name: 'MEDIUM',   value: 628, color: '#ffaa00' },
  { name: 'HIGH',     value: 189, color: '#ff8800' },
  { name: 'CRITICAL', value: 55,  color: '#ff4455' },
];

const ZONE_DATA = [
  { zone: 'Zone 1', detections: 412, cleaned: 240 },
  { zone: 'Zone 2', detections: 298, cleaned: 180 },
  { zone: 'Zone 3', detections: 187, cleaned: 140 },
  { zone: 'Zone 4', detections: 267, cleaned: 90  },
  { zone: 'Zone 5', detections: 120, cleaned: 88  },
];

const PERIODS = ['Today', '7 Days', '30 Days', 'Custom'];

export default function EnvironmentalAI() {
  const [period, setPeriod] = useState('7 Days');

  return (
    <div className="p-3 space-y-6 sm:p-6">
      {/* Header KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Detections" value="1,284"     color="#00d4ff" icon={<Target className="w-5 h-5" />} trend="up"   trendValue="+23% vs last week" />
        <StatCard label="Espada Validation" value="PENDING" color="#00ff88" icon={<Brain className="w-5 h-5" />} subvalue="Shown after held-out evaluation" />
        <StatCard label="Avg Response"     value="1.8h"      color="#ffaa00" icon={<Zap className="w-5 h-5" />}   trend="down" trendValue="-0.4h faster" />
        <StatCard label="Cleared Debris"   value="2,840 kg"  color="#aa55ff" icon={<Activity className="w-5 h-5" />} trend="up" trendValue="+12% this week" />
      </div>

      {/* Period tabs */}
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Analytics period">
        {PERIODS.map(p => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            aria-pressed={period === p}
            className={`min-h-11 px-4 py-1.5 rounded-lg text-xs font-medium border transition-all md:min-h-9 ${
              period === p
                ? 'bg-cyan-500/15 border-cyan-500/60 text-cyan-400'
                : 'border-[var(--ocean-border)] text-[var(--ocean-text-dim)] hover:border-cyan-500/30'
            }`}
          >
            {p}
          </button>
        ))}
      </div>

      {/* Charts row 1 */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Trend area chart */}
        <Card className="xl:col-span-2" noPad>
          <CardHeader title="Debris Detection Trend" subtitle={`Last 7 days by category · ${period}`} icon={<TrendingUp className="w-4 h-4" />} className="px-4 pt-4" />
          <div role="img" aria-label="Debris detections increased over the last seven days, led by plastic at 232 detections on August 30.">
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={TREND_DATA} margin={{ left: -10, right: 12 }}>
              <defs>
                {[['plastic','#00d4ff'],['fishingGear','#ffaa00'],['metalGlass','#aa55ff'],['other','#6a9ab8']].map(([k,c]) => (
                  <linearGradient key={k} id={`g-${k}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={c} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={c} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="var(--ocean-border)" />
              <YAxis tick={{ fontSize: 11 }} stroke="var(--ocean-border)" />
              <Tooltip contentStyle={{ background: 'var(--ocean-card)', border: '1px solid var(--ocean-border)', borderRadius: 8 }} />
              {[['plastic','#00d4ff'],['fishingGear','#ffaa00'],['metalGlass','#aa55ff'],['other','#6a9ab8']].map(([k,c]) => (
                <Area key={k} type="monotone" dataKey={k} stroke={c} fill={`url(#g-${k})`} strokeWidth={2} dot={false} />
              ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Espada validation */}
        <Card noPad>
          <CardHeader title="Espada Performance" subtitle="Version 1 · validation required" icon={<Brain className="w-4 h-4" />} className="px-4 pt-4" />
          <div className="flex h-[220px] flex-col items-center justify-center px-6 text-center">
            <Brain className="mb-3 h-8 w-8 text-cyan-400" />
            <p className="text-sm font-semibold text-[var(--ocean-text)]">No fabricated accuracy score</p>
            <p className="mt-2 max-w-xs text-xs leading-relaxed text-[var(--ocean-text-dim)]">
              Precision, recall, F1, and mAP will appear after Espada is trained and evaluated on a held-out marine-debris dataset.
            </p>
          </div>
        </Card>
      </div>

      {/* Charts row 2 */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Category bar */}
        <Card noPad>
          <CardHeader title="Debris by Category" subtitle="Total classifications" className="px-4 pt-4" />
          <div role="img" aria-label="Debris by category: plastic 638, fishing gear 312, metal and glass 198, organic 89, and unknown 47.">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={CATEGORY_BAR} margin={{ left: -10, right: 12 }}>
              <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="var(--ocean-border)" />
              <YAxis tick={{ fontSize: 10 }} stroke="var(--ocean-border)" />
              <Tooltip contentStyle={{ background: 'var(--ocean-card)', border: '1px solid var(--ocean-border)', borderRadius: 8 }} />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {CATEGORY_BAR.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Risk distribution */}
        <Card noPad>
          <CardHeader title="Risk Distribution" subtitle="Score buckets" className="px-4 pt-4" />
          <div role="img" aria-label="Risk distribution: 412 low, 628 medium, 189 high, and 55 critical detections.">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={RISK_DIST} margin={{ left: -10, right: 12 }}>
              <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="var(--ocean-border)" />
              <YAxis tick={{ fontSize: 10 }} stroke="var(--ocean-border)" />
              <Tooltip contentStyle={{ background: 'var(--ocean-card)', border: '1px solid var(--ocean-border)', borderRadius: 8 }} />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {RISK_DIST.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Zone breakdown */}
        <Card noPad>
          <CardHeader title="Detections vs Cleaned" subtitle="By monitoring zone" className="px-4 pt-4" />
          <div role="img" aria-label="Detections versus cleaned debris by zone. Zone 1 has the largest count with 412 detected and 240 cleaned.">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={ZONE_DATA} margin={{ left: -10, right: 12 }}>
              <XAxis dataKey="zone" tick={{ fontSize: 10 }} stroke="var(--ocean-border)" />
              <YAxis tick={{ fontSize: 10 }} stroke="var(--ocean-border)" />
              <Tooltip contentStyle={{ background: 'var(--ocean-card)', border: '1px solid var(--ocean-border)', borderRadius: 8 }} />
              <Bar dataKey="detections" name="Detected" fill="#00d4ff" radius={[4, 4, 0, 0]} opacity={0.7} />
              <Bar dataKey="cleaned"    name="Cleaned"  fill="#00ff88" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* Insights strip */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { icon: <TrendingUp className="h-5 w-5" />, label: 'Plastic +23%', desc: 'Plastic debris increased 23% vs last week. Primary driver: Pacific Gyre accumulation.', color: '#ff4455' },
          { icon: <Radio className="h-5 w-5" />, label: 'Fishing Gear +12%', desc: 'Fishing net detections increased 12%. Zone 4 shows highest concentration.', color: '#ffaa00' },
          { icon: <AlertTriangle className="h-5 w-5" />, label: 'Zone A — Highest Risk', desc: 'Zone 1 accumulated 412 detections, surpassing Zone 4 for the first time this month.', color: '#ff8800' },
        ].map(i => (
          <Card key={i.label} className="border-l-2" style={{ borderLeftColor: i.color } as any}>
            <div className="flex items-start gap-3">
              <span style={{ color: i.color }} aria-hidden="true">{i.icon}</span>
              <div>
                <p className="text-sm font-semibold text-[var(--ocean-text)]">{i.label}</p>
                <p className="text-xs text-[var(--ocean-text-dim)] mt-1 leading-relaxed">{i.desc}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
