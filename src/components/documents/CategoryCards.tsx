import { FileText, FilePenLine, FolderArchive, Files } from 'lucide-react';

interface CategoryCardsProps {
  leaseAgreementsCount: number;
  amendmentsCount: number;
  supportingDocsCount: number;
  totalCount: number;
}

export function CategoryCards({
  leaseAgreementsCount,
  amendmentsCount,
  supportingDocsCount,
  totalCount,
}: CategoryCardsProps) {
  const cards = [
    {
      label: 'Lease Agreements',
      count: leaseAgreementsCount,
      icon: FileText,
      iconBg: 'bg-blue-100',
      iconColor: 'text-blue-600',
    },
    {
      label: 'Amendments',
      count: amendmentsCount,
      icon: FilePenLine,
      iconBg: 'bg-amber-100',
      iconColor: 'text-amber-600',
    },
    {
      label: 'Supporting Documents',
      count: supportingDocsCount,
      icon: FolderArchive,
      iconBg: 'bg-emerald-100',
      iconColor: 'text-emerald-600',
    },
    {
      label: 'Total Documents',
      count: totalCount,
      icon: Files,
      iconBg: 'bg-slate-100',
      iconColor: 'text-slate-600',
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div
            key={card.label}
            className="bg-white border border-slate-200 rounded-xl p-5 flex items-center gap-4"
          >
            <div className={`p-3 rounded-lg ${card.iconBg} flex-shrink-0`}>
              <Icon className={`w-6 h-6 ${card.iconColor}`} />
            </div>
            <div className="min-w-0">
              <p className="text-2xl font-bold text-slate-900 leading-none">{card.count}</p>
              <p className="text-xs font-medium text-slate-500 mt-1 truncate">{card.label}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
