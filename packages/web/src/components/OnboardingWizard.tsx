import { useState } from 'react';
import {
  ArrowRight,
  Bot,
  Brain,
  CheckCircle2,
  Plug,
  Rocket,
  Users,
} from 'lucide-react';

const STORAGE_KEY = 'dw_onboarded';

type Step = {
  icon: React.ElementType;
  color: string;
  gradient: string;
  title: string;
  description: string;
  tip?: string;
  cta?: { label: string; page: string };
};

const STEPS: Step[] = [
  {
    icon: Rocket,
    color: '#5B6CF9',
    gradient: 'from-indigo-500 to-violet-500',
    title: 'Welcome to Dakyworld Hub!',
    description:
      'You now have an AI-powered marketing team at your fingertips. Daky and 4 specialist agents — Nova, Sage, Aria, and Flux — are ready to help you create content, grow your audience, and automate your marketing.',
    tip: 'This quick setup takes about 2 minutes.',
  },
  {
    icon: Plug,
    color: '#10B981',
    gradient: 'from-emerald-500 to-teal-500',
    title: 'Connect your social accounts',
    description:
      'Head to Integrations and connect your Twitter, Instagram, LinkedIn, or Facebook. Once connected, Daky will learn your social presence and start personalising advice for your audience.',
    cta: { label: 'Go to Integrations', page: 'integrations' },
    tip: 'Your account handle and follower count are automatically saved to your memory.',
  },
  {
    icon: Brain,
    color: '#F59E0B',
    gradient: 'from-amber-500 to-orange-500',
    title: 'Tell Daky about your brand',
    description:
      'Visit the Memory page and add details about your brand — your niche, tone of voice, target audience, and goals. The more you share, the smarter every response gets.',
    cta: { label: 'Open Memory', page: 'memory' },
    tip: 'All 5 agents read your memory before every response.',
  },
  {
    icon: Bot,
    color: '#8B5CF6',
    gradient: 'from-violet-500 to-purple-500',
    title: 'Chat with your AI butler',
    description:
      'Click the chat icon in the bottom-right of any page to open Daky. Ask for a content strategy, request a post draft, get analytics insights, or run the whole agent team on a complex task.',
    tip: 'Try: "Write me 5 LinkedIn post ideas for a SaaS targeting small businesses."',
  },
  {
    icon: Users,
    color: '#EC4899',
    gradient: 'from-pink-500 to-rose-500',
    title: 'Invite your team',
    description:
      'Under any project in the sidebar, click General → Team to invite colleagues. Assign them to tasks, manage roles, and collaborate on campaigns — all in one place.',
    cta: { label: 'Open Project Settings', page: 'project-settings' },
    tip: 'Use the Tasks page to create a Kanban board and assign work to team members.',
  },
  {
    icon: CheckCircle2,
    color: '#10B981',
    gradient: 'from-emerald-500 to-green-500',
    title: "You're all set!",
    description:
      'Your workspace is ready. Start by opening the chat, asking Daky a question about your marketing strategy, or scheduling your first post.',
    tip: 'Check the notification bell for updates from your AI agent team.',
  },
];

type Props = {
  onNavigate: (page: string) => void;
  onComplete?: () => void;
  onDismiss?: () => void;
};


export default function OnboardingWizard({ onNavigate, onComplete, onDismiss }: Props) {
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(true);

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;
  const progress = ((step + 1) / STEPS.length) * 100;

  const dismiss = (completed = false) => {
    localStorage.setItem(STORAGE_KEY, '1');
    setVisible(false);
    if (completed) onComplete?.();
    else onDismiss?.();
  };

  const next = () => {
    if (isLast) { dismiss(true); return; }
    setStep((s) => s + 1);
  };

  const navigateCta = (page: string) => {
    dismiss(false);
    onNavigate(page);
  };

  if (!visible) return null;

  const Icon = current.icon;

  return (
    <div className="fixed inset-0 z-[300] flex flex-col bg-white overflow-hidden">
      {/* Top progress bar */}
      <div className="h-1 w-full bg-gray-100 shrink-0">
        <div
          className="h-full bg-indigo-600 transition-all duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Main content — two columns on desktop, stacked on mobile */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left panel — visual */}
        <div className={`hidden md:flex w-[420px] shrink-0 flex-col items-center justify-center bg-gradient-to-br ${current.gradient} text-white p-12 relative overflow-hidden transition-all duration-500`}>
          {/* Background orbs */}
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute -top-24 -left-24 w-96 h-96 rounded-full bg-white/10 blur-3xl" />
            <div className="absolute -bottom-24 -right-24 w-96 h-96 rounded-full bg-white/10 blur-3xl" />
          </div>

          {/* Logo mark */}
          <div className="absolute top-8 left-8 flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-white/20 flex items-center justify-center">
              <span className="text-xs font-black text-white">D</span>
            </div>
            <span className="text-sm font-bold text-white/80">Dakyworld Hub</span>
          </div>

          {/* Icon */}
          <div className="relative z-10 flex h-28 w-28 items-center justify-center rounded-3xl bg-white/20 backdrop-blur-sm mb-8 shadow-2xl">
            <Icon size={52} className="text-white" />
          </div>

          {/* Step label */}
          <div className="relative z-10 mb-3 rounded-full bg-white/20 px-3 py-1 text-[11px] font-bold tracking-widest uppercase">
            Step {step + 1} of {STEPS.length}
          </div>

          {/* Heading echo */}
          <p className="relative z-10 text-center text-xl font-bold text-white/90 leading-snug max-w-xs">
            {current.title}
          </p>

          {/* Step dots */}
          <div className="absolute bottom-8 left-0 right-0 flex justify-center gap-2">
            {STEPS.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setStep(i)}
                className="h-1.5 rounded-full transition-all duration-300"
                style={{
                  width: i === step ? 24 : 6,
                  background: i === step ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.35)',
                }}
              />
            ))}
          </div>
        </div>

        {/* Right panel — content */}
        <div className="flex flex-1 flex-col items-center justify-center p-8 md:p-16 overflow-y-auto">
          <div className="w-full max-w-lg space-y-6">

            {/* Mobile: icon + step */}
            <div className="md:hidden flex items-center gap-3 mb-2">
              <div className={`flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ${current.gradient}`}>
                <Icon size={22} className="text-white" />
              </div>
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                Step {step + 1} of {STEPS.length}
              </span>
            </div>

            {/* Title */}
            <div>
              <h1 className="text-3xl font-black tracking-tight text-gray-900 leading-tight">
                {current.title}
              </h1>
            </div>

            {/* Description */}
            <p className="text-[15px] text-gray-600 leading-relaxed">
              {current.description}
            </p>

            {/* Tip */}
            {current.tip && (
              <div className="rounded-2xl bg-indigo-50 border border-indigo-100 px-5 py-4 text-[13px] text-indigo-700 leading-relaxed">
                <span className="font-semibold">💡 Tip — </span>{current.tip}
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-3 pt-2">
              {current.cta && (
                <button
                  type="button"
                  onClick={() => navigateCta(current.cta!.page)}
                  className="flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-5 py-3 text-[13px] font-semibold text-indigo-700 hover:bg-indigo-100 transition-colors"
                >
                  {current.cta.label}
                </button>
              )}
              <button
                type="button"
                onClick={next}
                className="ml-auto flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-3 text-[14px] font-bold text-white hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-200"
              >
                {isLast ? 'Get started' : 'Continue'}
                {!isLast && <ArrowRight size={15} />}
              </button>
            </div>

            {/* Skip */}
            {!isLast && (
              <div className="text-center pt-1">
                <button
                  type="button"
                  onClick={() => dismiss(false)}
                  className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                >
                  Skip setup
                </button>
              </div>
            )}

            {/* Mobile dots */}
            <div className="md:hidden flex justify-center gap-1.5 pt-2">
              {STEPS.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setStep(i)}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    i === step ? 'w-6 bg-indigo-600' : 'w-1.5 bg-gray-200'
                  }`}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
