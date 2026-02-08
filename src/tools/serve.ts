const AI_DISCLOSURE_FOOTER = `
<div style="margin-top:40px;padding:12px;border-top:1px solid #ccc;font-size:0.85em;color:#666;">
  This content was created by an autonomous AI entity.
</div>`;

const AI_META_TAG = '<meta name="generator" content="autonomous-ai-agent">';

export function injectDisclosure(html: string): string {
  // Add meta tag if <head> exists
  if (html.includes('<head>') && !html.includes('autonomous-ai-agent')) {
    html = html.replace('<head>', '<head>\n  ' + AI_META_TAG);
  }

  // Add disclosure footer before </body> if present, otherwise append
  if (!html.includes('This content was created by an autonomous AI entity')) {
    if (html.includes('</body>')) {
      html = html.replace('</body>', AI_DISCLOSURE_FOOTER + '\n</body>');
    } else {
      html += AI_DISCLOSURE_FOOTER;
    }
  }

  return html;
}
