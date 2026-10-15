/** Browser side effects for the Compliance Center exports (file download and print dialog). */

export function downloadExcelFile(html: string, filename: string): void {
  const blob = new Blob(['\ufeff', html], { type: 'application/vnd.ms-excel' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function printHtmlInFrame(html: string): void {
  const existing = document.getElementById('compliance-print-frame');
  if (existing) existing.remove();
  const iframe = document.createElement('iframe');
  iframe.id = 'compliance-print-frame';
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const triggerPrint = () => {
    const win = iframe.contentWindow;
    if (!win) return;
    try {
      win.focus();
      win.print();
    } catch (e) {
      console.error('Print failed:', e);
    }
  };

  iframe.onload = () => {
    setTimeout(triggerPrint, 300);
  };

  const doc = iframe.contentDocument || iframe.contentWindow?.document;
  if (doc) {
    doc.open();
    doc.write(html);
    doc.close();
    if (doc.readyState === 'complete') {
      setTimeout(triggerPrint, 300);
    }
  }
}
