import { useNavigate } from 'react-router-dom';
import { Lock, ChevronRight } from 'lucide-react';

interface UpgradeCardProps {
  featureName: string;
  requiredPlan: string;
  description?: string;
}

export function UpgradeCard({ featureName, requiredPlan, description }: UpgradeCardProps) {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      <div className="max-w-md w-full text-center">
        <div className="w-16 h-16 bg-blue-100 rounded-2xl flex items-center justify-center mx-auto mb-5">
          <Lock className="w-8 h-8 text-blue-600" />
        </div>
        <h2 className="text-xl font-bold text-slate-900 mb-2">Available on {requiredPlan}</h2>
        <p className="text-sm text-slate-500 mb-6">
          {description || `The ${featureName} feature is not included in your current plan. Upgrade to ${requiredPlan} to unlock it.`}
        </p>
        <button
          onClick={() => navigate('/billing')}
          className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition shadow-sm"
        >
          Upgrade to {requiredPlan}
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
