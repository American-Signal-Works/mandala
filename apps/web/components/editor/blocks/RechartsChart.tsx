// apps/web/components/editor/blocks/RechartsChart.tsx
"use client"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@workspace/ui/components/chart"
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts"

type Datum = { key: string; value: number }

const baseConfig: ChartConfig = {
  value: { label: "Value", color: "var(--chart-1)" },
}

export function RechartsChart({
  type,
  data,
}: {
  type: "line" | "bar" | "pie" | "area"
  data: Datum[]
}) {
  if (type === "pie") {
    const pieConfig: ChartConfig = Object.fromEntries(
      data.map((d, i) => [
        d.key,
        { label: d.key, color: `var(--chart-${(i % 5) + 1})` },
      ])
    )
    return (
      <ChartContainer config={pieConfig} className="aspect-video max-h-[240px]">
        <PieChart>
          <ChartTooltip content={<ChartTooltipContent hideLabel />} />
          <ChartLegend content={<ChartLegendContent />} />
          <Pie data={data} dataKey="value" nameKey="key" outerRadius={80}>
            {data.map((d) => (
              <Cell key={d.key} fill={`var(--color-${d.key})`} />
            ))}
          </Pie>
        </PieChart>
      </ChartContainer>
    )
  }

  if (type === "line") {
    return (
      <ChartContainer
        config={baseConfig}
        className="aspect-video max-h-[240px]"
      >
        <LineChart data={data} margin={{ left: 12, right: 12 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="key"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
          />
          <YAxis tickLine={false} axisLine={false} tickMargin={8} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Line
            type="monotone"
            dataKey="value"
            stroke="var(--color-value)"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ChartContainer>
    )
  }

  if (type === "area") {
    return (
      <ChartContainer
        config={baseConfig}
        className="aspect-video max-h-[240px]"
      >
        <AreaChart data={data} margin={{ left: 12, right: 12 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="key"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
          />
          <YAxis tickLine={false} axisLine={false} tickMargin={8} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Area
            type="monotone"
            dataKey="value"
            stroke="var(--color-value)"
            fill="var(--color-value)"
            fillOpacity={0.3}
          />
        </AreaChart>
      </ChartContainer>
    )
  }

  // Bar (default)
  return (
    <ChartContainer config={baseConfig} className="aspect-video max-h-[240px]">
      <BarChart data={data} margin={{ left: 12, right: 12 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="key" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis tickLine={false} axisLine={false} tickMargin={8} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="value" fill="var(--color-value)" radius={4} />
      </BarChart>
    </ChartContainer>
  )
}
