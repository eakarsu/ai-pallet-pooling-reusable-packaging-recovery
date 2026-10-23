// Deterministic, offline fallback over a feature's own records. No provider calls.
export const FALLBACK_LABEL = "Deterministic fallback — not AI-generated";
const esc = (v) => { const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
export function filterRecords(records, { q = "", status = "", risk = "" } = {}) {
  const needle = String(q).trim().toLowerCase();
  return (records || []).filter((r) => {
    if (status && r.status !== status) return false;
    if (risk && r.risk !== risk) return false;
    if (!needle) return true;
    return [r.reference, r.title, r.owner, r.status, r.risk, r.payload ? JSON.stringify(r.payload) : ""].join(" ").toLowerCase().includes(needle);
  });
}
export function recordsToCsv(records) {
  const cols = ["id","reference","title","status","owner","risk","due_date","amount","payload"];
  return [cols.join(","), ...(records||[]).map(r => cols.map(c => esc(r[c])).join(","))].join("\n");
}
export function exportRecords(records, format = "json") {
  if (String(format).toLowerCase() === "csv") return { contentType: "text/csv; charset=utf-8", body: recordsToCsv(records), filename: "records.csv" };
  return { contentType: "application/json; charset=utf-8", body: JSON.stringify({ aiGenerated: false, count: (records||[]).length, items: records || [] }, null, 2), filename: "records.json" };
}
export function buildInsights(records, { featureTitle = "Records", valueLabel = "Value at risk" } = {}) {
  const rows = records || [];
  const totalAmount = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const highRisk = rows.filter(r => ["High","Critical"].includes(r.risk));
  const open = rows.filter(r => !["Approved","Closed"].includes(r.status));
  const closed = rows.filter(r => r.status === "Closed");
  const emptyTitles = rows.filter(r => !r.title || !String(r.title).trim()).length;
  return {
    aiGenerated: false, label: FALLBACK_LABEL, source: "own records",
    sections: [
      { id: "exception-triage", title: `${featureTitle} — exception triage`, label: FALLBACK_LABEL,
        metrics: [
          { label: "Records reviewed", value: rows.length }, { label: "High/Critical risk", value: highRisk.length },
          { label: "Open / not approved or closed", value: open.length }, { label: "Has records", value: rows.length > 0 },
          { label: "Records with empty title", value: emptyTitles },
          { label: "Highest-risk references", value: highRisk.slice(0,5).map(r => r.reference || "") } ],
        detail: highRisk.length ? `${highRisk.length} record(s) are High/Critical and should be reviewed first.` : "No High/Critical records in the current set." },
      { id: "value-summary", title: `${featureTitle} — value and status summary`, label: FALLBACK_LABEL,
        metrics: [
          { label: valueLabel, value: totalAmount }, { label: "Closed records", value: closed.length },
          { label: "Average amount (0 when none)", value: rows.length ? Math.round((totalAmount/rows.length)*100)/100 : 0 },
          { label: "Statuses present", value: [...new Set(rows.map(r=>r.status||""))] } ],
        detail: `${rows.length} record(s) totalling ${totalAmount} in the selected feature.` },
      { id: "next-actions", title: `${featureTitle} — recommended next actions`, label: FALLBACK_LABEL,
        metrics: [{ label: "Suggested actions", value: open.length }, { label: "AI-generated", value: false }],
        actions: [
          ...(highRisk.length ? ["Review High/Critical records first and retain guideline evidence."] : []),
          ...(open.length ? [`Work the ${open.length} open record(s) to an approved/closed state.`] : ["No open records: sample closed records for quality assurance."]),
          ...(emptyTitles ? ["Complete records that have an empty title."] : []),
          "Validate source evidence before any recovery or payment decision." ],
        detail: "Deterministic actions derived only from record status, risk and amount fields." },
    ],
  };
}
export function mountFeatureExtras(app, { pool, auth, featureById, config }) {
  const load = async (req) => { featureById(req.params.id); return (await pool.query("SELECT * FROM feature_records WHERE feature_id=$1 ORDER BY updated_at DESC,id DESC", [req.params.id])).rows; };
  app.get("/api/features/:id/export", auth, async (req, res, next) => { try { const rows = filterRecords(await load(req), req.query); const out = exportRecords(rows, req.query.format || "json"); res.setHeader("Content-Type", out.contentType); res.setHeader("Content-Disposition", `attachment; filename="${out.filename}"`); res.send(out.body); } catch(e){ next(e); } });
  app.get("/api/features/:id/insights", auth, async (req, res, next) => { try { const feature = featureById(req.params.id); const rows = filterRecords(await load(req), req.query); res.json({ insights: buildInsights(rows, { featureTitle: feature.title, valueLabel: config?.calculation?.varianceLabel || "Value at risk" }) }); } catch(e){ next(e); } });
}
