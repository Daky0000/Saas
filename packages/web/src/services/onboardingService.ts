import { api } from './apiClient';

export type OnboardingAnswers = {
  brandName: string;
  website: string;
  industry: string;
  offering: string;
  audience: string;
  tones: string[];
  goals: string[];
  platforms: string[];
};

export type OnboardingStatus = {
  success: boolean;
  completed: boolean;
  skipped: boolean;
  data: Partial<OnboardingAnswers> & { completed_at?: string; skipped_at?: string };
};

export type WebsiteSuggestions = {
  brandName: string;
  industry: string;
  offering: string;
  audience: string;
  tones: string[];
  platforms: string[];
};

export const onboardingService = {
  status: () => api.get<OnboardingStatus>('/api/onboarding'),
  complete: (answers: OnboardingAnswers) =>
    api.post<{ success: boolean; memoriesCreated: number }>('/api/onboarding', answers),
  skip: () => api.post<{ success: boolean }>('/api/onboarding/skip'),
  analyzeWebsite: (website: string) =>
    api.post<{ success: boolean; suggestions: WebsiteSuggestions; sourceUrl: string }>(
      '/api/onboarding/analyze-website',
      { website },
    ),
};
