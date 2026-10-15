import { useState, type RefObject } from 'react';
import { X, Upload, FileText } from 'lucide-react';
import { UPLOAD_ACCEPT_ATTRIBUTE } from '../../utils/uploadLimits';

interface UploadFormState {
  category: string;
  description: string;
}

interface UploadModalProps {
  uploadForm: UploadFormState;
  onFormChange: (form: UploadFormState) => void;
  uploading: boolean;
  uploadProgress: number;
  fileInputRef: RefObject<HTMLInputElement>;
  onFileUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onClose: () => void;
}

const CATEGORIES = [
  'Lease Agreements',
  'Amendments',
  'Supporting Documents',
  'General',
];

const inputClass =
  'w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition';
const labelClass = 'block text-sm font-semibold text-slate-700 mb-1.5';

export function UploadModal({
  uploadForm,
  onFormChange,
  uploading,
  uploadProgress,
  fileInputRef,
  onFileUpload,
  onClose,
}: UploadModalProps) {
  const [selectedFileName, setSelectedFileName] = useState<string>('');

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setSelectedFileName(file ? file.name : '');
    onFileUpload(event);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="bg-blue-100 p-2 rounded-lg">
              <Upload className="w-5 h-5 text-blue-600" />
            </div>
            <h2 className="text-xl font-bold text-slate-900">Upload Document</h2>
          </div>
          <button
            onClick={onClose}
            disabled={uploading}
            className="text-slate-500 hover:text-slate-600 transition disabled:opacity-40"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div>
            <label className={labelClass}>Category</label>
            <select
              value={uploadForm.category}
              onChange={(e) => onFormChange({ ...uploadForm, category: e.target.value })}
              disabled={uploading}
              className={inputClass}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass}>Description (optional)</label>
            <textarea
              value={uploadForm.description}
              onChange={(e) => onFormChange({ ...uploadForm, description: e.target.value })}
              disabled={uploading}
              placeholder="Add a note about this document..."
              rows={3}
              className={inputClass}
            />
          </div>

          <div>
            <label className={labelClass}>File</label>
            <label
              className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed border-slate-300 rounded-lg py-8 cursor-pointer transition hover:border-blue-400 hover:bg-blue-50/30 ${
                uploading ? 'pointer-events-none opacity-60' : ''
              }`}
            >
              <FileText className="w-8 h-8 text-slate-500" />
              <span className="text-sm font-semibold text-slate-700">
                {selectedFileName || 'Click to choose a file'}
              </span>
              <span className="text-xs text-slate-500">PDF, image, text, Word, Excel or PowerPoint &middot; max 50 MB</span>
              <input
                ref={fileInputRef}
                type="file"
                accept={UPLOAD_ACCEPT_ATTRIBUTE}
                className="hidden"
                onChange={handleFileChange}
                disabled={uploading}
              />
            </label>
          </div>

          {uploading && (
            <div className="space-y-1">
              <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-600 transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              <p className="text-xs text-slate-500 text-right">{uploadProgress}%</p>
            </div>
          )}
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-slate-200">
          <button
            onClick={onClose}
            disabled={uploading}
            className="flex-1 px-4 py-2.5 border border-slate-300 text-slate-700 font-semibold rounded-lg hover:bg-slate-50 transition disabled:opacity-50"
          >
            Cancel
          </button>
          <p className="flex-1 text-xs text-slate-500 self-center text-right">
            Select a file to begin the upload.
          </p>
        </div>
      </div>
    </div>
  );
}
