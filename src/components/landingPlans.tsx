import { Zap, Shield, Star } from 'lucide-react';

export interface Plan {
  key: string;
  name: string;
  subtitle: string;
  monthlyPrice: number;
  annualPrice: number;
  maxLeases: number;
  features: string[];
  icon: React.ReactNode;
  popular?: boolean;
  ctaVariant: 'outline' | 'filled' | 'dark';
}

export const plans: Plan[] = [
  {
    key: 'starter',
    name: 'Starter',
    subtitle: 'Up to 50 leases',
    monthlyPrice: 200,
    annualPrice: 170,
    maxLeases: 50,
    features: [
      'Up to 50 active leases',
      'ASC 842 Compliance',
      'Amortization schedules',
      'Journal entries',
    ],
    icon: <Zap className="w-5 h-5 text-blue-400" />,
    ctaVariant: 'outline',
  },
  {
    key: 'professional',
    name: 'Professional',
    subtitle: 'Up to 100 leases',
    monthlyPrice: 300,
    annualPrice: 255,
    maxLeases: 100,
    features: [
      'Up to 100 active leases',
      'Everything in Starter',
      'Contract modifications',
      'Branch management',
    ],
    icon: <Shield className="w-5 h-5 text-teal-400" />,
    popular: true,
    ctaVariant: 'filled',
  },
  {
    key: 'enterprise',
    name: 'Enterprise',
    subtitle: 'Up to 200 leases',
    monthlyPrice: 500,
    annualPrice: 425,
    maxLeases: 200,
    features: [
      'Up to 200 active leases',
      'Everything in Pro',
      'Up to 10 users',
      'Dedicated support',
    ],
    icon: <Star className="w-5 h-5 text-slate-500" />,
    ctaVariant: 'dark',
  },
];

export function getLandingPlanDisplay(planKey: string, billing: "monthly" | "annually"): { name: string; priceLabel: string } | null {
  const plan = plans.find(p => p.key === planKey);
  if (!plan) return null;
  const price = billing === "monthly" ? plan.monthlyPrice : plan.annualPrice;
  const cycleWord = billing === "monthly" ? "monthly" : "annually";
  return {
    name: plan.name,
    priceLabel: "$" + price + "/mo, billed " + cycleWord,
  };
}
