// Vercel Serverless Function: POST /api/submit
// Deploy this function on Vercel. Do not expose the GitHub token to client-side code.
// Environment variables:
//   GITHUB_RESULTS_TOKEN: fine-grained PAT, Contents read/write on results repo only
//   GITHUB_RESULTS_REPO: owner/private-results-repo
//   GITHUB_RESULTS_BRANCH: main (optional)
// Security note: public collection endpoints also require production abuse prevention.
const EXPECTED_CASES = new Map([
  [4663, ["Accountability", "Deep", "Near"]],
  [3056, ["Accountability", "Deep", "Far"]],
  [16230, ["Accountability", "Shallow", "Near"]],
  [7407, ["Accountability", "Shallow", "Far"]],
  [13115, ["Safety", "Deep", "Near"]],
  [7723, ["Safety", "Deep", "Far"]],
  [17048, ["Safety", "Shallow", "Near"]],
  [43621, ["Safety", "Shallow", "Far"]]
]);
const REQUIRED_ORIGIN = "https://i-kiran.github.io";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const csvEscape = (value) => {
  let s = String(value == null ? "" : value);
  // Prevent spreadsheet formula execution on CSV import.
  if (/^[\t\r\n ]*[=+\-@]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
};
function parsePayload(value) {
  const body = typeof value === "string" ? JSON.parse(value) : value;
  if (!body || typeof body !== "object") throw new Error("Invalid JSON body");
  const id = body.review_id;
  if (typeof id !== "string" || !UUID_V4.test(id)) throw new Error("Invalid review ID");
  if (!Array.isArray(body.responses) || body.responses.length !== 8) throw new Error("Expected eight responses");
  const responses = new Map();
  for (const r of body.responses) {
    if (!r || typeof r !== "object" || !Number.isInteger(r.case_id) || !EXPECTED_CASES.has(r.case_id)) {
      throw new Error("Unknown case ID");
    }
    if (responses.has(r.case_id)) throw new Error("Duplicate case ID");
    if (!Number.isInteger(r.relevance) || r.relevance < 1 || r.relevance > 7) {
      throw new Error("Every relevance score must be an integer from 1 to 7");
    }
    const explanation = r.explanation ?? "";
    if (typeof explanation !== "string" || explanation.length > 2000) {
      throw new Error("Explanation exceeds 2,000 characters");
    }
    responses.set(r.case_id, { relevance: r.relevance, explanation });
  }
  return { id, responses };
}
module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", REQUIRED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");
  if (req.headers.origin !== REQUIRED_ORIGIN) return res.status(403).json({ saved: false, error: "Origin not allowed" });
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ saved: false, error: "POST required" });
  if (Number(req.headers["content-length"] || 0) > 30000) {
    return res.status(413).json({ saved: false, error: "Payload too large" });
  }
  const token = process.env.GITHUB_RESULTS_TOKEN;
  const repository = process.env.GITHUB_RESULTS_REPO;
  const branch = process.env.GITHUB_RESULTS_BRANCH || "main";
  if (!token || !repository || !/^[\w.-]+\/[\w.-]+$/.test(repository)) {
    return res.status(503).json({ saved: false, error: "GitHub storage not configured" });
  }
  let data;
  try {
    data = parsePayload(req.body);
  } catch (e) {
    return res.status(400).json({ saved: false, error: e.message });
  }
  const completedAt = new Date().toISOString();
  const lines = ["review_id,completed_at,target_id,case_id,value,depth,distance,relevance_1_to_7,explanation"];
  for (const [caseId, [value, depth, distance]] of EXPECTED_CASES) {
    const r = data.responses.get(caseId);
    lines.push([data.id, completedAt, 55, caseId, value, depth, distance, r.relevance, r.explanation].map(csvEscape).join(","));
  }
  const content = Buffer.from(lines.join("\r\n") + "\r\n", "utf8").toString("base64");
  const filePath = "responses/" + data.id + ".csv";
  const url = "https://api.github.com/repos/" + repository + "/contents/" + filePath;
  const headers = {
    "Accept": "application/vnd.github+json",
    "Authorization": "Bearer " + token,
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
    "User-Agent": "precedent-study-results-receiver"
  };
  try {
    const existing = await fetch(url + "?ref=" + encodeURIComponent(branch), { headers });
    let sha;
    if (existing.status === 200) {
      const json = await existing.json();
      sha = json.sha;
    } else if (existing.status !== 404) {
      throw new Error("GitHub lookup failed: " + existing.status);
    }
    const update = await fetch(url, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        message: "Record anonymous precedent review " + data.id,
        content,
        branch,
        ...(sha ? { sha } : {})
      })
    });
    if (!update.ok) throw new Error("GitHub write failed: " + update.status);
    return res.status(200).json({ saved: true, review_id: data.id, path: filePath });
  } catch (err) {
    // Don't leak GitHub credentials or private repo information through the endpoint.
    return res.status(502).json({ saved: false, error: "GitHub write unavailable" });
  }
};
