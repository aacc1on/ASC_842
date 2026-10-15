import { useState } from 'react';
import { CheckCircle2, FileText, ChevronRight } from 'lucide-react';
import { plans } from './landingPlans';

interface LandingPageProps {
  onSelectPlan: (planKey: string, billing: 'monthly' | 'annually') => void;
}

export function LandingPage({ onSelectPlan }: LandingPageProps) {
  const [billing, setBilling] = useState<'monthly' | 'annually'>('monthly');

  return (
    <div className="flex flex-col h-full overflow-y-auto px-8 py-10 text-white">
      {/* Logo */}
      <div className="mb-10">
        <div className="flex items-center gap-3">
          <div className="bg-blue-500 rounded-xl p-2">
            <FileText className="w-5 h-5 text-white" />
          </div>
          <span className="text-lg font-bold tracking-tight">Lease Accountant</span>
        </div>
        <p className="text-sm text-slate-500 mt-1 pl-11">
          Product of{' '}
          <a
            href="https://www.ms-consult.us"
            target="_blank"
            rel="noopener noreferrer"
            className="text-slate-400 hover:text-slate-200 hover:underline transition"
          >
            www.ms-consult.us
          </a>
        </p>
      </div>

      {/* Headline */}
      <div className="mb-8">
        <div className="inline-flex items-center gap-2 bg-slate-700/60 border border-slate-600 rounded-full px-4 py-1.5 text-xs font-medium text-slate-300 mb-5">
          <span className="w-2 h-2 rounded-full bg-blue-400 inline-block"></span>
          Simple, transparent pricing
        </div>
        <h1 className="text-3xl font-extrabold leading-tight mb-3">
          Choose the plan<br />
          <span className="text-blue-400">that fits your portfolio.</span>
        </h1>
        <p className="text-slate-500 text-sm leading-relaxed max-w-md">
          All plans include ASC 842 compliance, automated amortization, and journal entries. Switch or cancel anytime.
        </p>
      </div>

      {/* Billing toggle */}
      <div className="flex items-center gap-3 mb-6">
        <div className="flex items-center bg-slate-800 border border-slate-700 rounded-xl p-1 gap-1">
          <button
            onClick={() => setBilling('monthly')}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition ${
              billing === 'monthly'
                ? 'bg-white text-slate-900 shadow'
                : 'text-slate-500 hover:text-white'
            }`}
          >
            Monthly
          </button>
          <button
            onClick={() => setBilling('annually')}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition flex items-center gap-2 ${
              billing === 'annually'
                ? 'bg-white text-slate-900 shadow'
                : 'text-slate-500 hover:text-white'
            }`}
          >
            Annual
            <span className="bg-teal-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-md">-15%</span>
          </button>
        </div>
      </div>

      {/* Plan cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {plans.map(plan => {
          const price = billing === 'monthly' ? plan.monthlyPrice : plan.annualPrice;
          return (
            <div
              key={plan.key}
              className={`relative rounded-2xl p-5 border transition ${
                plan.popular
                  ? 'bg-slate-800/80 border-teal-500 shadow-lg shadow-teal-900/30'
                  : 'bg-slate-800/50 border-slate-700'
              }`}
            >
              {plan.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="bg-teal-500 text-white text-xs font-bold px-3 py-1 rounded-full whitespace-nowrap">
                    Most Popular
                  </span>
                </div>
              )}

              <div className="bg-slate-700/50 w-9 h-9 rounded-xl flex items-center justify-center mb-3">
                {plan.icon}
              </div>

              <div className="font-bold text-white mb-0.5">{plan.name}</div>
              <div className={`text-xs font-medium mb-3 ${plan.popular ? 'text-teal-400' : 'text-blue-400'}`}>
                {plan.subtitle}
              </div>

              <div className="flex items-baseline gap-1 mb-1">
                <span className="text-3xl font-extrabold">${price}</span>
                <span className="text-slate-500 text-sm">/mo</span>
              </div>
              <div className="text-xs text-slate-500 mb-4">
                {billing === 'monthly' ? 'billed monthly' : 'billed annually'}
              </div>

              <ul className="space-y-2 mb-5">
                {plan.features.map(f => (
                  <li key={f} className="flex items-start gap-2 text-xs text-slate-300">
                    <CheckCircle2 className={`w-4 h-4 flex-shrink-0 mt-0.5 ${plan.popular ? 'text-teal-400' : 'text-blue-400'}`} />
                    {f}
                  </li>
                ))}
              </ul>

              <button
                onClick={() => onSelectPlan(plan.key, billing)}
                className={`w-full py-2.5 rounded-xl text-sm font-semibold transition flex items-center justify-center gap-1 ${
                  plan.popular
                    ? 'bg-teal-500 hover:bg-teal-400 text-white'
                    : plan.ctaVariant === 'dark'
                    ? 'bg-slate-700 hover:bg-slate-600 text-white border border-slate-600'
                    : 'bg-slate-700/60 hover:bg-slate-600 text-white border border-slate-600'
                }`}
              >
                Get started
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Annual savings banner */}
      <div className="flex items-center gap-3 bg-slate-800/50 border border-slate-700 rounded-xl px-5 py-3 mb-8 text-sm text-slate-300">
        <CheckCircle2 className="w-5 h-5 text-teal-400 flex-shrink-0" />
        <span>
          <span className="font-bold text-white">Save 15%</span> when you pay annually — switch any time in your billing settings.
        </span>
      </div>

      {/* Trust badges */}
      <div className="flex items-center gap-6 text-xs text-slate-500 mt-auto">
        <div className="flex items-center gap-1.5">
          <span className="text-xs">&#128274;</span>
          AES-256 Encrypted
        </div>
      </div>
    </div>
  );
}
