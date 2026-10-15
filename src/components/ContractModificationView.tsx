import { CreditCard as Edit3, Plus, Search, CheckCircle, AlertCircle, XCircle } from 'lucide-react';
import { useContractModificationsData } from '../hooks/useContractModificationsData';
import { useContractModForm } from '../hooks/useContractModForm';
import { useContractModActions } from '../hooks/useContractModActions';
import { filteredModifications, filteredCancellations } from './contract-mods/contractModHelpers';
import { ModificationsTable } from './contract-mods/ModificationsTable';
import { CancellationsTable } from './contract-mods/CancellationsTable';
import { ModificationFormModal } from './contract-mods/ModificationFormModal';
import { CancellationFormModal } from './contract-mods/CancellationFormModal';
import { ViewModificationModal } from './contract-mods/ViewModificationModal';
import { LoadError } from './LoadError';

export function ContractModificationView() {
  const {
    modifications,
    cancellations,
    leases,
    loading,
    error: loadError,
    loadData,
    retry,
  } = useContractModificationsData();

  const {
    activeTab,
    setActiveTab,
    showModificationModal,
    setShowModificationModal,
    showCancellationModal,
    setShowCancellationModal,
    showViewModal,
    setShowViewModal,
    selectedModification,
    setSelectedModification,
    editingModification,
    setEditingModification,
    searchQuery,
    setSearchQuery,
    submitting,
    setSubmitting,
    successMessage,
    setSuccessMessage,
    errorMessage,
    setErrorMessage,
    modPage,
    setModPage,
    canPage,
    setCanPage,
    modPageSize,
    setModPageSize,
    canPageSize,
    setCanPageSize,
    modificationForm,
    setModificationForm,
    cancellationForm,
    setCancellationForm,
    resetModificationForm,
    resetCancellationForm,
    populateModificationFormForEdit,
    openViewModal,
  } = useContractModForm();

  const {
    handleModificationSubmit,
    handleCancellationSubmit,
    handleDeleteModification,
  } = useContractModActions({
    leases,
    modificationForm,
    cancellationForm,
    editingModification,
    loadData,
    setSubmitting,
    setErrorMessage,
    setSuccessMessage,
    setShowModificationModal,
    setShowCancellationModal,
    setEditingModification,
    resetModificationForm,
    resetCancellationForm,
  });

  const visibleModifications = filteredModifications(modifications, searchQuery);
  const visibleCancellations = filteredCancellations(cancellations, searchQuery);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  const closeModificationModal = () => {
    setShowModificationModal(false);
    setEditingModification(null);
    resetModificationForm();
  };

  const closeViewModal = () => {
    setShowViewModal(false);
    setSelectedModification(null);
  };

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
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-3xl font-bold text-slate-900 mb-2 flex items-center gap-3">
                <Edit3 className="w-8 h-8 text-blue-600" />
                Contract Management
              </h1>
              <p className="text-slate-600">Manage contract modifications and cancellations</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowModificationModal(true)}
                className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition shadow-md hover:shadow-lg"
              >
                <Plus className="w-5 h-5" />
                New Modification
              </button>
              <button
                onClick={() => setShowCancellationModal(true)}
                className="flex items-center gap-2 px-6 py-3 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg transition shadow-md hover:shadow-lg"
              >
                <XCircle className="w-5 h-5" />
                Cancel Contract
              </button>
            </div>
          </div>

          <div className="flex gap-4 mb-6 border-b border-slate-200">
            <button
              onClick={() => { setActiveTab('modifications'); setModPage(1); }}
              className={`px-6 py-3 font-semibold transition border-b-2 ${
                activeTab === 'modifications'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              Modifications ({modifications.length})
            </button>
            <button
              onClick={() => { setActiveTab('cancellations'); setCanPage(1); }}
              className={`px-6 py-3 font-semibold transition border-b-2 ${
                activeTab === 'cancellations'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              Cancellations ({cancellations.length})
            </button>
          </div>

          <div className="mb-6">
            <div className="relative">
              <Search className="absolute left-4 top-3.5 w-5 h-5 text-slate-500" />
              <input
                type="text"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setModPage(1);
                  setCanPage(1);
                }}
                className="w-full pl-12 pr-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              />
            </div>
          </div>

          {loadError && <LoadError message={loadError} onRetry={retry} />}

          {!loadError && activeTab === 'modifications' && (
            <ModificationsTable
              modifications={visibleModifications}
              page={modPage}
              pageSize={modPageSize}
              submitting={submitting}
              onView={openViewModal}
              onEdit={populateModificationFormForEdit}
              onDelete={handleDeleteModification}
              onPageChange={setModPage}
              onPageSizeChange={setModPageSize}
            />
          )}

          {!loadError && activeTab === 'cancellations' && (
            <CancellationsTable
              cancellations={visibleCancellations}
              page={canPage}
              pageSize={canPageSize}
              onPageChange={setCanPage}
              onPageSizeChange={setCanPageSize}
            />
          )}
        </div>
      </div>

      <ModificationFormModal
        show={showModificationModal}
        editing={!!editingModification}
        submitting={submitting}
        leases={leases}
        form={modificationForm}
        onFormChange={setModificationForm}
        onSubmit={handleModificationSubmit}
        onClose={closeModificationModal}
      />

      <CancellationFormModal
        show={showCancellationModal}
        submitting={submitting}
        leases={leases}
        form={cancellationForm}
        onFormChange={setCancellationForm}
        onSubmit={handleCancellationSubmit}
        onClose={() => setShowCancellationModal(false)}
      />

      <ViewModificationModal
        show={showViewModal}
        modification={selectedModification}
        leases={leases}
        onClose={closeViewModal}
      />
    </div>
  );
}
