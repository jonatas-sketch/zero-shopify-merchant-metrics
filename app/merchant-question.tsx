"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { readMerchantStream, type MetricChart } from "../lib/merchant-stream";

const examples = [
  "What were sales last week?",
  "What were the best sellers this month?",
  "How many Outerwear order lines were returned last week?",
  "How many repeat customers did we have this month?",
];

function formatValue(value: number) {
  return value.toLocaleString("en", { maximumFractionDigits: 2 });
}

const dayMs = 86_400_000;
const toDay = (date: string) => Date.parse(date) / dayMs;
const fromDay = (day: number) => new Date(day * dayMs).toISOString().slice(0, 10);
const formatDay = (label: string) => label.slice(5);
const shortenProduct = (label: string) => label.length > 20 ? label.slice(0, 18) + "…" : label;
const formatMeasure = (measure: string) => (value: unknown) =>
  [typeof value === "number" ? formatValue(value) : String(value), measure];

function ChartPlot({ chart }: { chart: MetricChart }) {
  const { kind, points, measure, filters } = chart;
  if (kind === "metric") {
    const repeat = points[0].value;
    const total = points[1].value;
    return <div className="repeat-metric">
      <strong>{(repeat / total).toLocaleString("en", { style: "percent", maximumFractionDigits: 1 })}</strong>
      <span>{repeat} of {total} customers were repeat customers</span>
    </div>;
  }

  if (kind === "line") {
    const days = points.map(({ label, value }) => ({ day: toDay(label), value }));
    return <ResponsiveContainer width="100%" height={250}>
      <LineChart data={days} margin={{ right: 12 }}>
        <CartesianGrid stroke="#d9e3db" />
        <XAxis dataKey="day" type="number" domain={[toDay(filters.startDate), toDay(filters.endDate)]}
          allowDecimals={false} tickFormatter={(day) => formatDay(fromDay(day))} />
        <YAxis type="number" width={65} tickFormatter={formatValue} />
        <Tooltip labelFormatter={(day) => fromDay(Number(day))} formatter={formatMeasure(measure)} />
        <Line dataKey="value" stroke="#286948" strokeWidth={2} dot isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>;
  }

  const ranking = kind === "ranking";
  return <ResponsiveContainer width="100%" height={ranking ? Math.max(180, points.length * 33 + 40) : 250}>
    <BarChart data={points} layout={ranking ? "vertical" : "horizontal"} margin={{ right: 12 }}>
      <CartesianGrid horizontal={!ranking} vertical={ranking} stroke="#d9e3db" />
      {ranking
        ? <><XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="label" width={122} tickFormatter={shortenProduct} /></>
        : <><XAxis type="category" dataKey="label" tickFormatter={formatDay} /><YAxis type="number" width={55} allowDecimals={false} tickFormatter={formatValue} /></>}
      <Tooltip formatter={formatMeasure(measure)} />
      <Bar dataKey="value" name={measure} fill="#286948" isAnimationActive={false} />
    </BarChart>
  </ResponsiveContainer>;
}

function ChartCard({ chart }: { chart: MetricChart }) {
  const { title, measure, points, filters, kind } = chart;
  const rowLabel = kind === "ranking" ? "Product" : kind === "metric" ? "Cohort" : "Date";

  return (
    <figure className="merchant-chart">
      <figcaption>
        <strong>{title}</strong>
        <span>{filters.startDate} to {filters.endDate}</span>
        {filters.product && <span>Product: {filters.product}</span>}
        {filters.category && <span>Category: {filters.category}</span>}
      </figcaption>
      {points.length === 0 ? <p>No records matched these filters.</p> : (
        <>
          {kind === "metric" ? <ChartPlot chart={chart} /> :
            <div role="img" aria-label={`${title}. ${measure}.`}><ChartPlot chart={chart} /></div>}
          <details>
            <summary>View exact values</summary>
            <table>
              <thead><tr><th scope="col">{rowLabel}</th><th scope="col">{measure}</th></tr></thead>
              <tbody>{points.map(({ id, label, value }) =>
                <tr key={id ?? label}><th scope="row">{label}</th><td>{formatValue(value)}</td></tr>
              )}</tbody>
            </table>
          </details>
          {chart.returns?.length ? (
            <div className="returns-table">
              <table>
                <caption>Returned order lines</caption>
                <thead><tr>
                  {["Product", "Variant", "Return date", "Reason", "Refund"].map((label) =>
                    <th key={label} scope="col">{label}</th>)}
                </tr></thead>
                <tbody>{chart.returns.map(({ product, variant, returnedOn, reason, refundCents }, index) =>
                  <tr key={index}>
                    <th scope="row">{product}</th><td>{variant ?? "Unavailable"}</td><td>{returnedOn}</td>
                    <td>{reason ?? "Unavailable"}</td><td>{(refundCents / 100).toLocaleString("en", {
                      minimumFractionDigits: 2, maximumFractionDigits: 2,
                    })}</td>
                  </tr>)}</tbody>
              </table>
            </div>
          ) : null}
        </>
      )}
    </figure>
  );
}

export function MerchantQuestion() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [charts, setCharts] = useState<{ id: string; chart: MetricChart }[]>([]);
  const [status, setStatus] = useState<"idle" | "working" | "done" | "cancelled">("idle");
  const [error, setError] = useState("");
  const active = useRef<AbortController | null>(null);

  useEffect(() => () => active.current?.abort(), []);

  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!question.trim() || active.current) return;

    const controller = new AbortController();
    active.current = controller;
    setStatus("working");
    setAnswer("");
    setCharts([]);
    setError("");

    try {
      const response = await fetch("/api/merchant/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        throw new Error(typeof detail?.error === "string" ? detail.error : "Could not start the report.");
      }
      if (!response.body) throw new Error("The report did not return a response.");

      for await (const item of readMerchantStream(response.body)) {
        if (item.type === "chart") setCharts((current) => [...current, { id: item.id, chart: item.chart }]);
        if (item.type === "text") setAnswer((current) => current + item.text);
        if (item.type === "error") throw new Error(item.message);
        if (item.type === "done") {
          setStatus("done");
          return;
        }
      }
      throw new Error("The response ended before the report was complete.");
    } catch (problem) {
      if (controller.signal.aborted) {
        setStatus("cancelled");
      } else {
        setError(problem instanceof Error ? problem.message : "The report could not be completed.");
        setStatus("idle");
      }
    } finally {
      if (active.current === controller) active.current = null;
    }
  }

  return (
    <section className="merchant-questions" aria-labelledby="merchant-question-title">
      <h2 id="merchant-question-title">Ask about your orders</h2>
      <form onSubmit={ask}>
        <label className="merchant-question">
          Question
          <input value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={600} required />
        </label>
        <button type="submit" disabled={!question.trim() || status === "working"}>Ask</button>
        {status === "working" && <button type="button" className="secondary" onClick={() => active.current?.abort()}>Stop</button>}
      </form>
      <ul className="merchant-examples" aria-label="Example questions">
        {examples.map((example) => <li key={example}>
          <button type="button" className="secondary" onClick={() => setQuestion(example)}>{example}</button>
        </li>)}
      </ul>
      <p role="status" className="merchant-status">
        {status === "working" ? (charts.length ? "Writing the explanation…" : "Preparing your report…") :
          status === "cancelled" ? "Response stopped." : ""}
      </p>
      {error && <p role="alert">{error}</p>}
      {status === "working" && charts.length === 0 &&
        <div className="chart-loading" aria-hidden="true"><span /><span /><span /><span /><span /></div>}
      {charts.map(({ id, chart }) => <ChartCard key={id} chart={chart} />)}
      {answer && <p className="merchant-answer">{answer.replaceAll("**", "").replace(/\$(?=\d)/g, "")}</p>}
    </section>
  );
}
