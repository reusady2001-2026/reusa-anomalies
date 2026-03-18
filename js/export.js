// ============================================================
// EXPORT.JS — Excel (.xlsx) and HTML export
// ============================================================

const Exporter = (() => {

  // ── HTML EXPORT ───────────────────────────────────────

  /**
   * Open the current table as a full HTML page in a new tab.
   */
  function exportHTML(tableHTML, title) {
    const styles = document.querySelector('style') ? document.querySelector('style').outerHTML : '';
    const doc = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>${title || 'Anomaly Analysis Report'}</title>
  ${styles}
  <style>
    body { font-family: Arial, sans-serif; padding: 20px; background: #fff; }
    .anomaly-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .anomaly-table th, .anomaly-table td { border: 1px solid #ddd; padding: 4px 8px; text-align: right; }
    .anomaly-table th { background: #1a237e; color: #fff; text-align: center; }
    .cell-material-positive { background: #2e7d32 !important; color: #fff !important; }
    .cell-material-negative { background: #b71c1c !important; color: #fff !important; }
    .cell-anomaly { outline: 2px solid #e65100 !important; }
    .cell-seasonal-material { background: #e65100 !important; color: #fff !important; }
    .cell-skipped { color: #999; background: #f5f5f5; }
    .trend-positive { color: #2e7d32; }
    .trend-negative { color: #b71c1c; }
  </style>
</head>
<body>
  <h2>${title || 'Anomaly Analysis Report'}</h2>
  <p>Generated: ${new Date().toLocaleString()}</p>
  ${tableHTML}
</body>
</html>`;
    const blob = new Blob([doc], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  }

  // ── EXCEL EXPORT ──────────────────────────────────────

  /**
   * Export using SheetJS with inline styles.
   * Requires XLSX global from CDN.
   */
  function exportExcel(result, title, purchasePrice, materialFocusActive) {
    if (typeof XLSX === 'undefined') {
      alert('Excel export requires the SheetJS library. Please check your connection and try again.');
      return;
    }

    const { months, displayMonths, activeMonths, skippedMonths, metrics } = result;
    const dispLabels = displayMonths.map(i => months[i]);
    const skippedRelIdxs = displayMonths
      .map((mi, ri) => skippedMonths.includes(mi) ? ri : -1)
      .filter(x => x >= 0);

    const wb = XLSX.utils.book_new();
    const wsData = [];

    // Header row
    const headerRow = ['Metric', 'Section', ...dispLabels, 'Trend', '12M Trend', '3M Trend', 'Strongest Q', 'Weakest Q'];
    wsData.push(headerRow);

    metrics.forEach(metric => {
      if (metric.type === 'all_zero') return;
      const row = [metric.name, metric.section];
      dispLabels.forEach((_, ri) => {
        const val = metric.displayValues ? metric.displayValues[ri] : 0;
        row.push(val);
      });
      const tr = metric.trends || {};
      row.push(tr.trend || '', tr.trend12m || '', tr.trend3m || '');
      const q = metric.quarters || {};
      row.push(q.strongestQ || '', q.weakestQ || '');
      wsData.push(row);
    });

    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // Apply column widths
    const colWidths = [{ wch: 35 }, { wch: 12 }];
    dispLabels.forEach(() => colWidths.push({ wch: 14 }));
    ['Trend', '12M', '3M', 'Best Q', 'Worst Q'].forEach(() => colWidths.push({ wch: 12 }));
    ws['!cols'] = colWidths;

    XLSX.utils.book_append_sheet(wb, ws, 'Analysis');
    XLSX.writeFile(wb, `${(title || 'anomaly-report').replace(/\s+/g, '-')}.xlsx`);
  }

  // ── COMPARISON EXPORT ─────────────────────────────────

  function exportComparisonHTML(tableHTML, dashboardHTML, titleA, titleB) {
    const title = `Comparison: ${titleA} vs ${titleB}`;
    const doc = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>${title}</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 20px; background: #fff; font-size: 13px; }
    .dashboard-wrap { display: flex; gap: 20px; margin-bottom: 20px; }
    .dashboard-card { border: 1px solid #ddd; padding: 16px; border-radius: 8px; min-width: 200px; }
    .anomaly-table { width: 100%; border-collapse: collapse; font-size: 11px; }
    .anomaly-table th, .anomaly-table td { border: 1px solid #ddd; padding: 3px 6px; text-align: right; }
    .anomaly-table th { background: #1a237e; color: #fff; text-align: center; }
    .cell-material-positive { background: #2e7d32 !important; color: #fff !important; }
    .cell-material-negative { background: #b71c1c !important; color: #fff !important; }
    .cell-anomaly { outline: 2px solid #e65100 !important; }
    .cell-seasonal-material { background: #e65100 !important; color: #fff !important; }
    .cell-skipped { color: #999; background: #f5f5f5; }
    .asset-label-a { background: #e3f2fd; font-weight: bold; }
    .asset-label-b { background: #fce4ec; font-weight: bold; }
    .delta-row td { background: #f9fbe7; font-size: 10px; text-align: center; }
    .delta-anomaly { outline: 2px solid #7b1fa2 !important; }
    .delta-pos { color: #2e7d32; }
    .delta-neg { color: #b71c1c; }
    .trend-positive { color: #2e7d32; }
    .trend-negative { color: #b71c1c; }
  </style>
</head>
<body>
  <h2>${title}</h2>
  <p>Generated: ${new Date().toLocaleString()}</p>
  <div class="dashboard-wrap">${dashboardHTML}</div>
  ${tableHTML}
</body>
</html>`;
    const blob = new Blob([doc], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  }

  return { exportHTML, exportExcel, exportComparisonHTML };
})();
