// Vercel serverless function — no external dependencies, native fetch only.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function sbFetch(supabaseUrl, anonKey, path, opts = {}) {
  return fetch(`${supabaseUrl}/rest/v1${path}`, {
    ...opts,
    headers: {
      'Content-Type':  'application/json',
      'apikey':        anonKey,
      'Authorization': `Bearer ${anonKey}`,
      ...(opts.headers || {}),
    },
  });
}

export default async function handler(req, res) {
  // ── Preflight ────────────────────────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    res.writeHead(200, CORS_HEADERS);
    res.end();
    return;
  }

  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'POST') {
    res.status(405).json({ success: false, error: 'Method not allowed' });
    return;
  }

  const SUPABASE_URL      = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    res.status(500).json({ success: false, error: 'Supabase env vars not configured' });
    return;
  }

  const { action, candidateId, ruleText } = req.body;

  if (!action || (action !== 'approve' && action !== 'dismiss')) {
    res.status(400).json({ success: false, error: 'action must be "approve" or "dismiss"' });
    return;
  }
  if (!candidateId) {
    res.status(400).json({ success: false, error: 'candidateId is required' });
    return;
  }
  if (action === 'approve' && !ruleText?.trim()) {
    res.status(400).json({ success: false, error: 'ruleText is required for approve' });
    return;
  }

  try {
    // ── Fetch candidate row ──────────────────────────────────────────────────
    const candidateFetch = await sbFetch(
      SUPABASE_URL, SUPABASE_ANON_KEY,
      `/rule_candidates?id=eq.${encodeURIComponent(candidateId)}&select=id,metric_name,section,pattern_type,dismissal_count&limit=1`,
      { method: 'GET' }
    );

    if (!candidateFetch.ok) {
      const txt = await candidateFetch.text();
      throw new Error(`rule_candidates fetch failed (${candidateFetch.status}): ${txt}`);
    }

    const rows = await candidateFetch.json();
    if (!rows || rows.length === 0) {
      res.status(400).json({ success: false, error: 'Candidate not found' });
      return;
    }
    const candidate = rows[0];

    const now = new Date().toISOString();

    if (action === 'approve') {
      // ── 1. Insert into rules ───────────────────────────────────────────────
      const ruleInsert = await sbFetch(SUPABASE_URL, SUPABASE_ANON_KEY, '/rules', {
        method: 'POST',
        body: JSON.stringify({
          metric_name:   candidate.metric_name,
          section:       candidate.section,
          pattern_type:  candidate.pattern_type,
          rule_text:     ruleText.trim(),
          source:        'user_approved',
          candidate_id:  candidateId,
        }),
      });

      if (!ruleInsert.ok) {
        const txt = await ruleInsert.text();
        throw new Error(`rules insert failed (${ruleInsert.status}): ${txt}`);
      }

      // ── 2. Update candidate status ─────────────────────────────────────────
      const candidatePatch = await sbFetch(
        SUPABASE_URL, SUPABASE_ANON_KEY,
        `/rule_candidates?id=eq.${encodeURIComponent(candidateId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            status:       'approved',
            approved_rule: ruleText.trim(),
            updated_at:   now,
          }),
        }
      );

      if (!candidatePatch.ok) {
        const txt = await candidatePatch.text();
        throw new Error(`rule_candidates patch failed (${candidatePatch.status}): ${txt}`);
      }

    } else {
      // ── dismiss ──────────────────────────────────────────────────────────
      const newDismissalCount = (candidate.dismissal_count || 0) + 1;
      const isRetired = newDismissalCount >= 5;

      const patch = isRetired
        ? {
            dismissal_count: newDismissalCount,
            status:          'retired',
            updated_at:      now,
          }
        : {
            dismissal_count:                  newDismissalCount,
            status:                           'candidate',
            occurrences_since_last_dismissal: 0,
            last_suggested_at:                now,
            updated_at:                       now,
          };

      const candidatePatch = await sbFetch(
        SUPABASE_URL, SUPABASE_ANON_KEY,
        `/rule_candidates?id=eq.${encodeURIComponent(candidateId)}`,
        { method: 'PATCH', body: JSON.stringify(patch) }
      );

      if (!candidatePatch.ok) {
        const txt = await candidatePatch.text();
        throw new Error(`rule_candidates patch failed (${candidatePatch.status}): ${txt}`);
      }
    }

    res.status(200).json({ success: true, action });

  } catch (err) {
    console.error('[save-rule] error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}
