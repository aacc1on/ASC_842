import { useState, useEffect, useRef, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import {
  Plus, FolderOpen, Search, FileSpreadsheet,
  CheckCircle, AlertCircle,
} from 'lucide-react';
import { MonthEndDocumentsView } from './MonthEndDocumentsView';
import { useToast } from './toastContextTypes';
import { getErrorMessage, toUserMessage } from '../utils/errors';
import { currentOrgId } from '../utils/currentOrg';
import { LoadError } from './LoadError';
import { UserRole, UserPermissions } from '../App';
import { CategoryCards } from './documents/CategoryCards';
import { DocumentTable } from './documents/DocumentTable';
import { UploadModal } from './documents/UploadModal';
import type { Document } from './documents/types';
import { ALLOWED_UPLOAD_MIME_TYPES, MAX_UPLOAD_BYTES } from '../utils/uploadLimits';
import { fetchAll } from '../utils/fetchAll';

interface DocumentsViewProps {
  userRole: UserRole;
  permissions: UserPermissions;
  selectedCompanyId?: string | null;
}

export function DocumentsView({ permissions, selectedCompanyId }: DocumentsViewProps) {
  const { confirm: confirmDialog } = useToast();
  const [activeTab, setActiveTab] = useState<'files' | 'month-end'>('files');
  const [searchQuery, setSearchQuery] = useState('');
  const [documents, setDocuments] = useState<Document[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadRequest = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [uploadForm, setUploadForm] = useState({
    category: 'Lease Agreements',
    description: '',
  });

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
      const docs = await fetchAll<Document>('documents', (from, to) => supabase
        .from('documents')
        .select('*')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .order('id')
        .range(from, to));
      if (request === loadRequest.current) setDocuments(docs);
    } catch (err) {
      if (request === loadRequest.current) setLoadError(toUserMessage(err, 'Failed to load documents.'));
    } finally {
      if (request === loadRequest.current) setLoading(false);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const candidate = files[0];
    if (candidate.size > MAX_UPLOAD_BYTES) {
      setErrorMessage('That file is larger than the 50 MB limit.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    if (!ALLOWED_UPLOAD_MIME_TYPES.includes(candidate.type)) {
      setErrorMessage(
        'That file type is not supported. Please upload a PDF, image, text, Word, Excel or PowerPoint file.'
      );
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    setErrorMessage('');

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setErrorMessage('User not authenticated');
      setUploading(false);
      return;
    }

    const file = files[0];
    const extMatch = file.name.match(/\.([a-zA-Z0-9]+)$/);
    const fileExt = extMatch ? extMatch[1].toLowerCase() : 'bin';
    const safeExt = fileExt.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10) || 'bin';
    const fileId = crypto.randomUUID();
    // The storage rules require the first path segment to be the uploader's id;
    // organisation-wide visibility is resolved by those rules, not by the path.
    const filePath = `${user.id}/${fileId}.${safeExt}`;

    try {
      const { error: storageError } = await supabase.storage
        .from('documents')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false
        });

      if (storageError) {
        throw new Error('The file could not be uploaded. Please try again.');
      }

      setUploadProgress(50);

      const { error: dbError } = await supabase
        .from('documents')
        .insert([{
          user_id: user.id,
          file_name: file.name,
          file_path: filePath,
          file_type: safeExt,
          file_size: file.size,
          category: uploadForm.category,
          description: uploadForm.description,
        }]);

      if (dbError) throw dbError;

      setUploadProgress(100);
      setSuccessMessage('Document uploaded successfully!');
      setShowUploadModal(false);
      setUploadForm({ category: 'Lease Agreements', description: '' });

      await loadDocuments();

      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (error) {
      setErrorMessage(getErrorMessage(error) || 'Failed to upload document');
    }

    setUploading(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDownload = async (doc: Document) => {
    try {
      const { data, error } = await supabase.storage
        .from('documents')
        .download(doc.file_path);

      if (error) throw error;

      const url = URL.createObjectURL(data);
      const link = document.createElement('a');
      link.href = url;
      link.download = doc.file_name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setSuccessMessage('Document downloaded successfully!');
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (error) {
      setErrorMessage(getErrorMessage(error) || 'Failed to download document');
      setTimeout(() => setErrorMessage(''), 3000);
    }
  };

  const handleDelete = async (doc: Document) => {
    if (!await confirmDialog({ message: `Are you sure you want to delete "${doc.file_name}"?`, confirmLabel: 'Delete', destructive: true })) return;

    try {
      const { error: storageError } = await supabase.storage
        .from('documents')
        .remove([doc.file_path]);

      if (storageError) throw storageError;

      const { error: dbError } = await supabase
        .from('documents')
        .delete()
        .eq('id', doc.id);

      if (dbError) throw dbError;

      setSuccessMessage('Document deleted successfully!');
      await loadDocuments();
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (error) {
      setErrorMessage(getErrorMessage(error) || 'Failed to delete document');
      setTimeout(() => setErrorMessage(''), 3000);
    }
  };

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const doc of documents) {
      counts[doc.category] = (counts[doc.category] || 0) + 1;
    }
    return counts;
  }, [documents]);

  const getCategoryCount = (category: string) => categoryCounts[category] || 0;

  const filteredDocuments = useMemo(() => documents.filter((doc) =>
    doc.file_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    doc.category.toLowerCase().includes(searchQuery.toLowerCase())
  ), [documents, searchQuery]);

  const totalPages = Math.ceil(filteredDocuments.length / pageSize);
  const paginatedDocuments = filteredDocuments.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    setCurrentPage(1);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 py-8 px-4">
      <div className="max-w-7xl mx-auto">
        {successMessage && (
          <div className="mb-6 bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-green-600" />
            <p className="text-green-700 font-medium">{successMessage}</p>
          </div>
        )}

        {errorMessage && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-600" />
            <p className="text-red-700 font-medium">{errorMessage}</p>
          </div>
        )}

        <div className="bg-white rounded-xl shadow-lg p-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-3xl font-bold text-slate-900 mb-2">Documents</h1>
              <p className="text-slate-600">Manage and organize your lease-related documents</p>
            </div>
            {activeTab === 'files' && permissions.upload_documents && (
              <button
                onClick={() => setShowUploadModal(true)}
                className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition shadow-md hover:shadow-lg"
              >
                <Plus className="w-5 h-5" />
                Upload Document
              </button>
            )}
          </div>

          <div className="flex gap-1 bg-slate-100 rounded-xl p-1 mb-8 w-fit">
            <button
              onClick={() => setActiveTab('files')}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition ${
                activeTab === 'files'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <FolderOpen className="w-4 h-4" />
              Uploaded Files
            </button>
            <button
              onClick={() => setActiveTab('month-end')}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition ${
                activeTab === 'month-end'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <FileSpreadsheet className="w-4 h-4" />
              Month-End Documents
            </button>
          </div>

          {activeTab === 'month-end' && <MonthEndDocumentsView selectedCompanyId={selectedCompanyId} />}

          {activeTab === 'files' && <>
            <div className="mb-6">
              <div className="relative">
                <Search className="absolute left-4 top-3.5 w-5 h-5 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search documents..."
                  value={searchQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  className="w-full pl-12 pr-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                />
              </div>
            </div>

            {loadError ? <LoadError message={loadError} onRetry={loadDocuments} /> : <>
            <CategoryCards
              leaseAgreementsCount={getCategoryCount('Lease Agreements')}
              amendmentsCount={getCategoryCount('Amendments')}
              supportingDocsCount={getCategoryCount('Supporting Documents')}
              totalCount={documents.length}
            />

            <DocumentTable
              paginatedDocuments={paginatedDocuments}
              filteredDocumentsCount={filteredDocuments.length}
              searchQuery={searchQuery}
              currentPage={currentPage}
              totalPages={totalPages}
              pageSize={pageSize}
              canUploadDocuments={permissions.upload_documents}
              onDownload={handleDownload}
              onDelete={handleDelete}
              onPageChange={setCurrentPage}
              onPageSizeChange={(size) => { setPageSize(size); setCurrentPage(1); }}
            />
            </>}
          </>}
        </div>
      </div>

      {showUploadModal && (
        <UploadModal
          uploadForm={uploadForm}
          onFormChange={setUploadForm}
          uploading={uploading}
          uploadProgress={uploadProgress}
          fileInputRef={fileInputRef}
          onFileUpload={handleFileUpload}
          onClose={() => setShowUploadModal(false)}
        />
      )}
    </div>
  );
}
