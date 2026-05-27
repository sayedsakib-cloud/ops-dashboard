"use client";

import { useState, useEffect } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

interface PerformanceMetrics {
  totalKnock: number;
  newConversations: number;
  reopenedConversations: number;
  avgFRT: string;
  avgART: string;
  frtHitRate: string;
  artHitRate: string;
}

interface PerformanceData {
  success: boolean;
  period: { from: string; to: string };
  metrics: PerformanceMetrics;
  breakdown: {
    caseResolution: { totalKnock: number; newConversations: number; reopenedConversations: number; avgFRT: string };
    businessOperations: { totalKnock: number; newConversations: number; reopenedConversations: number; avgFRT: string };
  };
  timeseries: Array<{ date: string; count: number }>;
}

interface MetricCardProps {
  label: string;
  value: string | number;
  subtext?: string;
  trend?: "up" | "down" | "neutral";
  color?: "blue" | "green" | "red" | "purple" | "teal" | "yellow";
}

const MetricCard: React.FC<MetricCardProps> = ({ label, value, subtext, trend = "neutral", color = "blue" }) => {
  const colorStyles = {
    blue: "border-blue-500 bg-gradient-to-br from-blue-50 to-blue-100",
    green: "border-green-500 bg-gradient-to-br from-green-50 to-green-100",
    red: "border-red-500 bg-gradient-to-br from-red-50 to-red-100",
    purple: "border-purple-500 bg-gradient-to-br from-purple-50 to-purple-100",
    teal: "border-teal-500 bg-gradient-to-br from-teal-50 to-teal-100",
    yellow: "border-yellow-500 bg-gradient-to-br from-yellow-50 to-yellow-100",
  };

  const textColors = {
    blue: "text-blue-700",
    green: "text-green-700",
    red: "text-red-700",
    purple: "text-purple-700",
    teal: "text-teal-700",
    yellow: "text-yellow-700",
  };

  return (
    <div className={`${colorStyles[color]} border-l-4 rounded-lg p-6 shadow-md hover:shadow-lg transition-shadow`}>
      <p className="text-sm font-medium text-gray-600 mb-2">{label}</p>
      <p className={`text-3xl font-bold ${textColors[color]} mb-1`}>{value}</p>
      {subtext && <p className="text-xs text-gray-500">{subtext}</p>}
      {trend === "up" && <p className="text-xs text-green-600 mt-2">↑ Trending up</p>}
      {trend === "down" && <p className="text-xs text-red-600 mt-2">↓ Trending down</p>}
    </div>
  );
};

export default function PerformanceOverview() {
  const [data, setData] = useState<PerformanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fromDate, setFromDate] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 7);
    return date.toISOString().split("T")[0];
  });
  const [toDate, setToDate] = useState(new Date().toISOString().split("T")[0]);

  useEffect(() => {
    const fetchPerformance = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await fetch(`/api/performance?from=${fromDate}&to=${toDate}`);
        if (!response.ok) throw new Error("Failed to fetch performance data");
        const result = await response.json();
        setData(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
      } finally {
        setLoading(false);
      }
    };

    fetchPerformance();
  }, [fromDate, toDate]);

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-red-800">
        <h3 className="font-bold mb-2">Error Loading Performance Data</h3>
        <p>{error}</p>
      </div>
    );
  }

  if (loading) {
    return <div className="text-center py-12 text-gray-500">Loading performance metrics...</div>;
  }

  if (!data) {
    return <div className="text-center py-12 text-gray-500">No data available</div>;
  }

  const { metrics, timeseries } = data;

  return (
    <div className="space-y-6">
      {/* Header with Title and Date Range Filter */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Performance Overview</h2>
          <p className="text-sm text-gray-500 mt-1">Real-time metrics for Case Resolution & Business Operations</p>
        </div>
        <div className="flex gap-4">
          <div className="flex flex-col">
            <label className="text-xs font-medium text-gray-600 mb-1">From</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex flex-col">
            <label className="text-xs font-medium text-gray-600 mb-1">To</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <MetricCard
          label="TOTAL KNOCK COUNT"
          value={metrics.totalKnock.toLocaleString()}
          subtext="Conversations in period"
          color="blue"
        />
        <MetricCard
          label="NEW CONVERSATIONS"
          value={metrics.newConversations.toLocaleString()}
          subtext="Last 24 hours"
          color="green"
        />
        <MetricCard
          label="REOPENED CONVERSATIONS"
          value={metrics.reopenedConversations.toLocaleString()}
          subtext="In selected period"
          color="red"
        />
        <MetricCard
          label="FIRST RESPONSE TIME"
          value={metrics.avgFRT}
          subtext="Average across all tickets"
          color="purple"
        />
        <MetricCard
          label="AVG RESPONSE TIME"
          value={metrics.avgART}
          subtext="Average handling time"
          color="teal"
        />
        <MetricCard
          label="FRT HIT RATE"
          value={metrics.frtHitRate}
          subtext="Target: 2h threshold"
          color="yellow"
        />
      </div>

      {/* Timeseries Chart */}
      <div className="bg-white rounded-lg shadow-md p-6 border border-gray-100">
        <h3 className="text-lg font-bold text-gray-900 mb-4">Knock Count Timeseries</h3>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={timeseries} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="date"
              stroke="#6b7280"
              style={{ fontSize: "12px" }}
              tick={{ fill: "#6b7280" }}
            />
            <YAxis stroke="#6b7280" style={{ fontSize: "12px" }} tick={{ fill: "#6b7280" }} />
            <Tooltip
              contentStyle={{
                backgroundColor: "#1f2937",
                border: "1px solid #374151",
                borderRadius: "8px",
                color: "#fff",
              }}
              formatter={(value) => [`${value} conversations`, "Count"]}
              labelFormatter={(label) => `Date: ${label}`}
            />
            <Line
              type="monotone"
              dataKey="count"
              stroke="#3b82f6"
              dot={{ fill: "#3b82f6", r: 4 }}
              activeDot={{ r: 6 }}
              strokeWidth={3}
              isAnimationActive={true}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Breakdown Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Case Resolution Breakdown */}
        <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg shadow-md p-6 border border-blue-200">
          <h3 className="text-lg font-bold text-blue-900 mb-4">Case Resolution</h3>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-sm text-blue-800">Total Knock:</span>
              <span className="font-bold text-blue-900">{data.breakdown.caseResolution.totalKnock.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-blue-800">New Conversations:</span>
              <span className="font-bold text-blue-900">{data.breakdown.caseResolution.newConversations.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-blue-800">Reopened:</span>
              <span className="font-bold text-blue-900">{data.breakdown.caseResolution.reopenedConversations.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-blue-800">Avg FRT:</span>
              <span className="font-bold text-blue-900">{data.breakdown.caseResolution.avgFRT}</span>
            </div>
          </div>
        </div>

        {/* Business Operations Breakdown */}
        <div className="bg-gradient-to-br from-teal-50 to-teal-100 rounded-lg shadow-md p-6 border border-teal-200">
          <h3 className="text-lg font-bold text-teal-900 mb-4">Business Operations</h3>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-sm text-teal-800">Total Knock:</span>
              <span className="font-bold text-teal-900">{data.breakdown.businessOperations.totalKnock.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-teal-800">New Conversations:</span>
              <span className="font-bold text-teal-900">{data.breakdown.businessOperations.newConversations.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-teal-800">Reopened:</span>
              <span className="font-bold text-teal-900">{data.breakdown.businessOperations.reopenedConversations.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-teal-800">Avg FRT:</span>
              <span className="font-bold text-teal-900">{data.breakdown.businessOperations.avgFRT}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
