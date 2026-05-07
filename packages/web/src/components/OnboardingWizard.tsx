import { useState } from 'react';
import {
  ArrowRight,
  Bot,
  Brain,
  CheckCircle2,
  Plug,
  Rocket,
  Users,
  X,
} from 'lucide-react';

const STORAGE_KEY = 'dw_onboarded';

type Step = {
  icon: React.ElementType;
  iconBg: string;
  iconColor: string;
  title: string;
  description: string;
  tip?: string;
  cta?: { label: string; page: string };
};

const STEPS: Step[] = [
  {
    icon: Rocket,
    iconBg: 'bg-indigo-100',
    iconColor: 'text-indigo-600',
    title: 'Welcome to Dakyworld Hub!',
    description:
      'You now have an AI-powered marketing team at your fingertips. Daky and 4 specialist agents — Nova, Sage, Aria, and Flux — are ready to help you create content, grow your audience, and automate your marketing.',
    tip: 'This quick tour takes about 2 minutes.',
  },
  {
    icon: Plug,
    iconBg: 'bg-emerald-100',
    iconColor: 'text-emerald-600',
    title: 'Connect your social accounts',
    description:
      'Head to Integrations and connect your Twitter, Instagram, LinkedIn, or Facebook. Once connected, Daky will learn your social presence and start personalising advice for your audience.',
    cta: { label: 'Go to Integrations', page: 'integrations' },
    tip: 'Your account handle and follower count are automatically saved to your memory.',
  },
  {
    icon: Brain,
    iconBg: 'bg-amber-100',
    iconColor: 'text-amber-600',
    title: 'Tell Daky about your brand',
    description:
      'Visit the Memory (Personalization) page and add details about your brand — your niche, tone of voice, target audience, and goals. The more you share, the smarter every response gets.',
    cta: { label: 'Open Memory', page: 'memory' },
    tip: 'All 5 agents read your memory before every response.',
  },
  {
    icon: Bot,
    iconBg: 'bg-violet-100',
    iconColor: 'text-violet-600',
    title: 'Chat with your AI butler',
    description:
      'Click the chat icon in the bottom-right of any page to open Daky. Ask for a content strategy, request a post draft, get analytics insights, or run the whole agent team on a complex task.',
    tip: 'Try: "Write me 5 LinkedIn post ideas for a SaaS targeting small businesses."',
  },
  {
    icon: Users,
    iconBg: 'bg-pink-100',
    iconColor: 'text-pink-600',
    title: 'Invite your team',
    description:
      'Under any project in the sidebar, click General → Team to invite colleagues. Assign them to tasks, manage roles, and collaborate on campaigns — all in one place.',
    cta: { label: 'Open Project Settings', page: 'project-settings' },
    tip: 'Use the Tasks page to create a Kanban board and assign work to team members.',
  },
  {
    icon: CheckCircle2,
    iconBg: 'bg-green-100',
    iconColor: 'text-green-600',
    title: "You're all set!",
    description:
      'Your workspace is ready. Start by opening the chat, asking Daky a question about your marketing strategy, or scheduling your first post.',
    tip: 'Check the notification bell in the sidebar for updates from your agent team.',
  },
];

type Props = {
  onNavigate: (page: string) => void;
};

export function useOnboarding() {
  return !localStorage.getItem(STORAGE_KEY);
}

export default function OnboardingWizard({ onNavigate }: Props) {
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(true);

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, '1');
    setVisible(false);
  };

  const next = () => {
    if (isLast) { dismiss(); return; }
    setStep((s) => s + 1);
  };

  const navigateCta = (page: string) => {
    dismiss();
    onNavigate(page);
  };

  if (!visible) return null;

  const Icon = current.icon;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-md rounded-3xl border border-gray-200 bg-white shadow-2xl overflow-hidden">
        {/* Progress bar */}
        <div className="h-1 bg-gray-100">
          <div
            className="h-full bg-indigo-600 transition-all duration-500"
            style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
          />
        </div>

        {/* Close */}
        <button
          type="button"
          onClick={dismiss}
          className="absolute top-4 right-4 rounded-xl p-1.5 text-gray-400 hover:bg-gray-100 transition-colors z-10"
        >
          <X size={15} />
        </button>

        {/* Content */}
        <div className="px-8 pt-8 pb-6 space-y-5">
          {/* Icon */}
          <div className={`inline-flex h-14 w-14 items-center justify-center rounded-2xl ${current.iconBg}`}>
            <Icon size={26} className={current.iconColor} />
          </div>

          {/* Step counter */}
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
            Step {step + 1} of {STEPS.length}
          </p>

          {/* Title */}
          <h2 className="text-2xl font-black tracking-tight text-gray-900 leading-snug">
            {current.title}
          </h2>

          {/* Description */}
          <p className="text-[14px] text-gray-600 leading-relaxed">
            {current.description}
          </p>

          {/* Tip */}
          {current.tip && (
            <div className="rounded-xl bg-indigo-50 border border-indigo-100 px-4 py-3 text-[12px] text-indigo-700 leading-relaxed">
              💡 {current.tip}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            {current.cta && (
              <button
                type="button"
                onClick={() => navigateCta(current.cta!.page)}
                className="flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-[13px] font-semibold text-indigo-700 hover:bg-indigo-100 transition-colors"
              >
                {current.cta.label}
              </button>
            )}
            <button
              type="button"
              onClick={next}
              className="ml-auto flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-[13px] font-bold text-white hover:bg-indigo-700 transition-colors"
            >
              {isLast ? 'Get started' : 'Next'}
              {!isLast && <ArrowRight size={14} />}
            </button>
          </div>
        </div>

        {/* Step dots */}
        <div className="flex items-center justify-center gap-1.5 pb-5">
          {STEPS.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setStep(i)}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === step ? 'w-6 bg-indigo-600' : 'w-1.5 bg-gray-200 hover:bg-gray-300'
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
