import { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { FileSpreadsheet, AlertCircle, CheckCircle, Loader, Calendar } from 'lucide-react';
import { Pagination } from './Pagination';
import { useToast } from './toastContextTypes';
import { toUserMessage } from '../utils/errors';
import { currentOrgId } from '../utils/currentOrg';
import { LoadError } from './LoadError';
import { latestPostedBlocker } from '../utils/monthEndTransactions';
import { MonthEndPeriodFilter } from './documents/MonthEndPeriodFilter';
import { matchesPeriodFilter, type PeriodFilterValue } from './documents/periodFilter';
import { CatchUpCorrections } from './documents/CatchUpCorrections';
import { fetchAll } from '../utils/fetchAll';
import { documentYears, mapDocumentTransactions, undocumentedPeriods, type DocumentTransaction, type MonthEndDocument } from './documents/monthEndDocHelpers';
import { MonthEndDocumentSummary } from './documents/MonthEndDocumentSummary';
import { DocumentTransactionsTable } from './documents/DocumentTransactionsTable';

export function MonthEndDocumentsView({ selectedCompanyId }: { selectedCompanyId?: string | null }) {
  const { confirm: confirmDialog } = useToast();
  const [documents, setDocuments] = useState<MonthEndDocument[]>([]);
  const [expandedDocId, setExpandedDocId] = useState<string | null>(null);
  const [docTransactions, setDocTransactions] = useState<Record<string, DocumentTransaction[]>>({});
  const [loadingTransactions, setLoadingTransactions] = useState<Record<string, boolean>>({});
  const [deleting, setDeleting] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadRequest = useRef(0);
  const [pendingCatchUpPeriods, setPendingCatchUpPeriods] = useState<string[]>([]);
  const [docPage, setDocPage] = useState(1);
  const [docPageSize, setDocPageSize] = useState(10);
  const [periodFilter, setPeriodFilter] = useState<PeriodFilterValue>(() => {
    const now = new Date();
    return {
      mode: 'all',
      year: String(now.getFullYear()),
      month: String(now.getMonth() + 1).padStart(2, '0'),
      from: '',
      to: '',
    };
  });

  const years = useMemo(() => documentYears(documents, periodFilter.year), [documents, periodFilter.year]);

  const filteredDocuments = useMemo(
    () => documents.filter((d) => matchesPeriodFilter(d.period, periodFilter)),
    [documents, periodFilter],
  );

  const undocumentedCatchUpPeriods = useMemo(
    () => undocumentedPeriods(pendingCatchUpPeriods, documents),
    [pendingCatchUpPeriods, documents],
  );

  const handleFilterChange = (next: PeriodFilterValue) => {
    setPeriodFilter(next);
    setDocPage(1);
    setExpandedDocId(null);
  };

  useEffect(() => {
    const requests = loadRequest;
    loadDocuments();
    return () => { requests.current++; };
  }, []);

  const loadDocuments = async () => {
    const request = ++loadRequest.current;
    setLoading(true);
    setLoadError(null);
    try {
      const orgId = await currentOrgId();
      const [docs, catchUps] = await Promise.all([
        fetchAll<MonthEndDocument>('month-end documents', (from, to) => supabase
          .from('month_end_documents')
          .select('*')
          .eq('organization_id', orgId)
          .order('period', { ascending: false })
          .order('id')
          .range(from, to)),
        fetchAll<{ posting_period: string }>('catch-up corrections', (from, to) => supabase
          .from('month_end_catch_up_batches')
          .select('posting_period')
          .eq('organization_id', orgId)
          .eq('status', 'prepared')
          .order('id')
          .range(from, to)),
      ]);
      if (request !== loadRequest.current) return;
      setDocuments(docs);
      setPendingCatchUpPeriods(Array.from(new Set(catchUps.map((c) => c.posting_period))).sort());
    } catch (err) {
      if (request === loadRequest.current) setLoadError(toUserMessage(err, 'Month-end documents could not be loaded.'));
    } finally {
      if (request === loadRequest.current) setLoading(false);
    }
  };

  const loadTransactionsForDoc = async (docId: string) => {
    if (docTransactions[docId]) return;

    setLoadingTransactions(prev => ({ ...prev, [docId]: true }));

    let data: Record<string, unknown>[] | null = null;
    try {
      const orgId = await currentOrgId();
      data = await fetchAll<Record<string, unknown>>('document transactions', (from, to) => supabase
        .from('transactions')
        .select(`
          *,
          leases:lease_id (lease_name, company_id)
        `)
        .eq('organization_id', orgId)
        .eq('month_end_document_id', docId)
        .order('transaction_date', { ascending: true })
        .order('id')
        .range(from, to));
    } catch (err) {
      setErrorMessage(toUserMessage(err, 'Transactions for this document could not be loaded.'));
    }

    if (data) {
      const mapped = mapDocumentTransactions(data, selectedCompanyId);
      setDocTransactions(prev => ({ ...prev, [docId]: mapped }));
    }

    setLoadingTransactions(prev => ({ ...prev, [docId]: false }));
  };

  const handleToggleExpand = async (docId: string) => {
    if (expandedDocId === docId) {
      setExpandedDocId(null);
    } else {
      setExpandedDocId(docId);
      await loadTransactionsForDoc(docId);
    }
  };

  const handleDeleteDocument = async (doc: MonthEndDocument) => {
    const blocker = latestPostedBlocker(documents, doc);
    if (blocker) {
      setErrorMessage(blocker);
      setTimeout(() => setErrorMessage(''), 6000);
      return;
    }
    if (!await confirmDialog({
      message: `Delete month-end document for ${doc.period_label}?\n\nThis will permanently delete the document and all ${doc.transaction_count} associated journal entries. This action cannot be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
    })) return;

    setDeleting(doc.id);
    setErrorMessage('');

    const { error } = await supabase
      .from('month_end_documents')
      .delete()
      .eq('id', doc.id);

    if (error) {
      setErrorMessage(toUserMessage(error, 'Failed to delete document'));
      setTimeout(() => setErrorMessage(''), 4000);
    } else {
      setSuccessMessage(`Month-end document for ${doc.period_label} and all its transactions have been deleted.`);
      setTimeout(() => setSuccessMessage(''), 5000);
      if (expandedDocId === doc.id) setExpandedDocId(null);
      setDocTransactions(prev => {
        const next = { ...prev };
        delete next[doc.id];
        return next;
      });
      await loadDocuments();
    }

    setDeleting(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (loadError) return <LoadError message={loadError} onRetry={loadDocuments} />;

  return (
    <div>
      {successMessage && (
        <div className="mb-6 bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-3">
          <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
          <p className="text-green-700 font-medium">{successMessage}</p>
        </div>
      )}

      {errorMessage && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
          <p className="text-red-700 font-medium">{errorMessage}</p>
        </div>
      )}

      {undocumentedCatchUpPeriods.length > 0 && (
        <div className="mb-6 space-y-4">
          {undocumentedCatchUpPeriods.map((p) => (
            <CatchUpCorrections key={p} period={p} compact />
          ))}
        </div>
      )}

      {documents.length === 0 ? (
        <div className="text-center py-16 bg-slate-50 rounded-xl border border-slate-200">
          <FileSpreadsheet className="w-16 h-16 text-slate-300 mx-auto mb-4" />
          <p className="text-slate-600 font-semibold mb-2">No month-end documents yet</p>
          <p className="text-sm text-slate-500">
            Run the Month-End Process from the Transactions page to create your first posting document.
          </p>
        </div>
      ) : (
        <>
        <MonthEndPeriodFilter
          value={periodFilter}
          years={years}
          shownCount={filteredDocuments.length}
          totalCount={documents.length}
          onChange={handleFilterChange}
        />
        {filteredDocuments.length === 0 ? (
          <div className="text-center py-12 bg-slate-50 rounded-xl border border-slate-200">
            <Calendar className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-600 font-semibold mb-1">No documents in this period</p>
            <p className="text-sm text-slate-500">Try a different year, month, or date range.</p>
          </div>
        ) : (
        <div className="space-y-4">
          {filteredDocuments.slice((docPage - 1) * docPageSize, docPage * docPageSize).map((doc) => {
            const isExpanded = expandedDocId === doc.id;
            const txns = docTransactions[doc.id] || [];
            const isLoadingTxns = loadingTransactions[doc.id];
            const isDeletingThis = deleting === doc.id;

            return (
              <div
                key={doc.id}
                className="bg-white border-2 border-slate-200 rounded-xl shadow-sm overflow-hidden transition-all hover:border-slate-300"
              >
                <MonthEndDocumentSummary
                  doc={doc}
                  isExpanded={isExpanded}
                  isDeletingThis={isDeletingThis}
                  onToggle={() => handleToggleExpand(doc.id)}
                  onDelete={() => handleDeleteDocument(doc)}
                />

                {isExpanded && (
                  <div className="border-t-2 border-slate-100">
                    {isLoadingTxns ? (
                      <div className="flex items-center justify-center py-10 gap-3 text-slate-500">
                        <Loader className="w-5 h-5 animate-spin" />
                        <span className="text-sm font-medium">Loading transactions...</span>
                      </div>
                    ) : txns.length === 0 ? (
                      <div className="text-center py-8 text-slate-500 text-sm">
                        No transactions found for this document.
                      </div>
                    ) : (
                      <DocumentTransactionsTable periodLabel={doc.period_label} txns={txns} />
                    )}
                    <CatchUpCorrections period={doc.period} />
                  </div>
                )}
              </div>
            );
          })}
          {filteredDocuments.length > docPageSize && (
            <Pagination
              currentPage={docPage}
              totalPages={Math.ceil(filteredDocuments.length / docPageSize)}
              totalItems={filteredDocuments.length}
              pageSize={docPageSize}
              onPageChange={(page) => { setDocPage(page); setExpandedDocId(null); }}
              onPageSizeChange={(size) => { setDocPageSize(size); setDocPage(1); setExpandedDocId(null); }}
              pageSizeOptions={[5, 10, 25]}
            />
          )}
        </div>
        )}
        </>
      )}
    </div>
  );
}
